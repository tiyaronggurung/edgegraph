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

// Canonical target offset for the entry-timing study (seconds before close).
function targetOffsetOf(bucket: string): number {
  switch (bucket) {
    case "30s": return 30;
    case "1m":  return 60;
    case "2m":  return 120;
    case "5m":  return 300;
    case "10m": return 600;
    case "13m+": return 840;
    default: return 0;
  }
}

// Probability-calibration bucket for studying whether model prob matches
// actual win rate. Separate from the time-to-close snapshot bucket.
function calibrationBucketOf(modelSideProb: number): string {
  if (modelSideProb >= 0.90) return "p>=0.90";
  if (modelSideProb >= 0.85) return "p0.85-0.90";
  if (modelSideProb >= 0.75) return "p0.75-0.85";
  if (modelSideProb >= 0.65) return "p0.65-0.75";
  if (modelSideProb >= 0.55) return "p0.55-0.65";
  return "p<0.55";
}

// Phase 2 configurable shadow thresholds. These are hard-coded here for now;
// a future phase can move them to a config table or UI toggles.
const EV_CONFIG = {
  minEdgePts: 2.0,          // minimum edge in percentage points
  minEvPerStake10: 0.0,     // minimum EV on a hypothetical $10 stake
  minSideConf: 0.70,        // minimum chosen-side confidence
  // Higher confidence lets us pay a higher price and still expect value.
  priceCeilingByConf: [
    { minConf: 0.90, ceiling: 0.80 },
    { minConf: 0.80, ceiling: 0.75 },
    { minConf: 0.70, ceiling: 0.70 },
    { minConf: 0.00, ceiling: 0.65 },
  ] as { minConf: number; ceiling: number }[],
};

function priceCeilingForConf(sideConf: number): number {
  for (const tier of EV_CONFIG.priceCeilingByConf) {
    if (sideConf >= tier.minConf) return tier.ceiling;
  }
  return EV_CONFIG.priceCeilingByConf[EV_CONFIG.priceCeilingByConf.length - 1].ceiling;
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
    const sideConf = Number.isFinite(input.sideConf as number) ? (input.sideConf as number) : modelSideProb;
    const edgePts = (modelSideProb - selectedAsk) * 100;
    const priceCeiling = input.priceCeiling ?? priceCeilingForConf(sideConf);
    const minEdgeThreshold = input.minEdgeThreshold ?? EV_CONFIG.minEdgePts;
    const minEvThreshold = input.minEvThreshold ?? EV_CONFIG.minEvPerStake10;
    const minConfThreshold = input.minConfThreshold ?? EV_CONFIG.minSideConf;

    const passesPrice = selectedAsk <= priceCeiling;
    const passesEdge  = edgePts >= minEdgeThreshold;
    const passesEv    = evPer10 >= minEvThreshold;
    const passesConf  = sideConf >= minConfThreshold;
    const wouldFireGated = passesPrice && passesEdge && passesEv && passesConf && evPer10 > 0;

    const row = {
      ticker: input.ticker,
      event_ticker: input.eventTicker,
      close_time: input.closeTime,
      snapshot_bucket: bucket,
      target_offset_seconds: input.targetOffsetSeconds ?? targetOffsetOf(bucket),
      seconds_to_close: Math.max(0, Math.round(input.secondsToClose)),

      model_prob: modelYes,
      model_side: side,
      model_side_prob: modelSideProb,
      calibration_bucket: input.calibrationBucket ?? calibrationBucketOf(modelSideProb),
      side_confidence: sideConf,

      kalshi_yes_price: yesAsk,
      kalshi_no_price: 1 - yesAsk,
      selected_side_ask: selectedAsk,
      market_implied_prob: selectedAsk,
      edge_prob: modelSideProb - selectedAsk,
      edge_pts: edgePts,

      fee_est: fee,
      ev_per_contract: evPerContract,
      ev_per_stake_10: evPer10,
      would_fire: evPer10 > 0,

      price_ceiling: priceCeiling,
      min_edge_threshold: minEdgeThreshold,
      min_ev_threshold: minEvThreshold,
      min_conf_threshold: minConfThreshold,
      passes_price_ceiling: passesPrice,
      passes_edge: passesEdge,
      passes_ev: passesEv,
      passes_conf: passesConf,
      would_fire_gated: wouldFireGated,

      regime_tag: input.regimeTag ?? null,

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
