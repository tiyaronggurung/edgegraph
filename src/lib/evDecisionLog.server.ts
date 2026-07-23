// Server-only: shadow EV logger for BTC 15m windows.
// Records model_prob vs kalshi ask, expected value after fees, and
// hypothetical $10-stake P/L for every model snapshot. Backfilled with
// actual outcome + realized P/L when the window settles.
//
// PURELY SHADOW — never gates a live order. Fire-and-forget; never throws.
import type { SnapshotInput } from "./cryptoPredictions.server";

function bucketOf(secondsToClose: number): string {
  if (secondsToClose <= 45)  return "30s";
  if (secondsToClose <= 90)  return "1m";
  if (secondsToClose <= 180) return "2m";
  if (secondsToClose <= 360) return "5m";
  if (secondsToClose <= 660) return "10m";
  return "13m+";
}

// Kalshi fee approximation (per contract, in dollars).
function feePerContract(ask: number): number {
  if (!Number.isFinite(ask) || ask <= 0 || ask >= 1) return 0;
  return 0.07 * ask * (1 - ask);
}

export async function logEvDecision(input: SnapshotInput): Promise<void> {
  try {
    const yesAsk = Number(input.marketYesPrice);
    if (!Number.isFinite(yesAsk) || yesAsk <= 0 || yesAsk >= 1) return;

    const modelYes = Number(input.modelProb);
    if (!Number.isFinite(modelYes)) return;

    const side = input.side;
    const modelSideProb = side === "YES" ? modelYes : 1 - modelYes;
    const selectedAsk   = side === "YES" ? yesAsk   : 1 - yesAsk;
    if (selectedAsk <= 0 || selectedAsk >= 1) return;

    const fee = feePerContract(selectedAsk);
    const evPerContract = modelSideProb - selectedAsk - fee;
    const contracts     = 10 / selectedAsk;
    const evPer10       = evPerContract * contracts;

    const bucket = bucketOf(input.secondsToClose);

    const row = {
      ticker: input.ticker,
      event_ticker: input.eventTicker,
      close_time: input.closeTime,
      snapshot_bucket: bucket,
      seconds_to_close: Math.max(0, Math.round(input.secondsToClose)),

      model_prob: modelYes,
      model_side: side,
      model_side_prob: modelSideProb,

      kalshi_yes_price: yesAsk,
      kalshi_no_price: 1 - yesAsk,
      selected_side_ask: selectedAsk,
      market_implied_prob: selectedAsk,
      edge_prob: modelSideProb - selectedAsk,
      edge_pts: (modelSideProb - selectedAsk) * 100,

      fee_est: fee,
      ev_per_contract: evPerContract,
      ev_per_stake_10: evPer10,
      would_fire: evPer10 > 0,

      spot_at_snapshot: input.spot ?? null,
      strike: input.strike ?? null,
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ev_decision_log").insert(row);
    // Duplicate key from (ticker, snapshot_bucket) idempotency is expected.
    if (error && !/duplicate key/i.test(error.message)) {
      console.warn("[evDecisionLog] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[evDecisionLog] unexpected (swallowed):", (e as Error)?.message ?? e);
  }
}

// Backfill actual_outcome + realized $10 P/L for a settled window.
// Called from settleDuePredictions after Kalshi finalizes the outcome.
export async function backfillEvOutcome(
  ticker: string,
  outcome: "YES" | "NO",
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("ev_decision_log")
      .select("id, model_side, selected_side_ask, fee_est")
      .eq("ticker", ticker)
      .is("actual_outcome", null);
    if (!rows?.length) return;

    const nowIso = new Date().toISOString();
    await Promise.all(rows.map(async (r) => {
      const ask = Number(r.selected_side_ask);
      const fee = Number(r.fee_est);
      const won = (r.model_side as string) === outcome;
      const contracts = ask > 0 ? 10 / ask : 0;
      // Fees applied on winning contracts only (Kalshi convention).
      const pnl = won
        ? contracts * (1 - ask) - contracts * fee
        : -contracts * ask;

      await supabaseAdmin
        .from("ev_decision_log")
        .update({
          actual_outcome: outcome,
          was_correct: won,
          realized_pnl_10: Math.round(pnl * 100) / 100,
          settled_at: nowIso,
        })
        .eq("id", r.id);
    }));
  } catch (e) {
    console.warn("[evDecisionLog] backfill failed (swallowed):", (e as Error)?.message ?? e);
  }
}
