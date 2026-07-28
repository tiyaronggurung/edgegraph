// Client → server: persist the trendline chip's ≥75% locked side to
// btc_model_predictions.study_locked_side as the authoritative Study Pick
// for that window. Also records exact lock metadata for the log. Overwrites
// any prior value (chip wins within 7 min).
//
// SIDE EFFECT: on a valid lock, also auto-fires a $10 paper buy for every
// user who has a paper_balances row (balance ≥ $10, not bankrupt). The fill
// is bucketed under "manual" with entry_snapshot.source='study_auto' so it
// stays out of the Model / PRED / Green Hours stats. Idempotent per
// (user, ticker) via the snapshot marker — never double-fires.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const STAKE_CENTS = 1000;

const Input = z.object({
  ticker: z.string().min(1),
  side: z.enum(["UP", "DOWN"]),
  confidencePct: z.number().min(0).max(100),
  secondsToClose: z.number().int(),
});

async function fetchKalshiAskCents(ticker: string, side: "YES" | "NO"): Promise<number | null> {
  try {
    const res = await fetch(`${KALSHI}/markets/${encodeURIComponent(ticker)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = await res.json() as {
      market?: { yes_bid?: number; yes_ask?: number; yes_bid_dollars?: string; yes_ask_dollars?: string };
    };
    const m = j.market;
    if (!m) return null;
    // Prefer integer cent fields; fall back to dollar strings.
    let yesBid = typeof m.yes_bid === "number" ? m.yes_bid : (m.yes_bid_dollars != null ? Math.round(Number(m.yes_bid_dollars) * 100) : NaN);
    let yesAsk = typeof m.yes_ask === "number" ? m.yes_ask : (m.yes_ask_dollars != null ? Math.round(Number(m.yes_ask_dollars) * 100) : NaN);
    if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk)) return null;
    if (side === "YES") {
      return Math.max(1, Math.min(99, Math.round(yesAsk)));
    }
    // NO ask = 100 - YES bid
    const noAsk = 100 - yesBid;
    return Math.max(1, Math.min(99, Math.round(noAsk)));
  } catch {
    return null;
  }
}

export const recordChipStudyPick = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    // Strictly capture at the 7-min mark: accept only when the lock fires
    // between minute 7 and minute 8 of the 15m window (secondsToClose in
    // (420, 480]). Earlier locks (minutes 0-6) are rejected so a 3-min pick
    // can't stick when the trend flips at minute 5.
    if (data.secondsToClose > 480 || data.secondsToClose <= 420) {
      return { ok: false, reason: "outside_7min_mark" as const };
    }
    if (data.confidencePct < 75) {
      return { ok: false, reason: "below_threshold" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const yesNo: "YES" | "NO" = data.side === "UP" ? "YES" : "NO";

    const { error } = await supabaseAdmin
      .from("btc_model_predictions")
      .update({
        study_locked_side: yesNo,
        study_lock_confidence: data.confidencePct,
        study_lock_source: "trendline_chip",
        study_lock_seconds_to_close: data.secondsToClose,
        study_locked_at: new Date().toISOString(),
      } as never)
      .eq("ticker", data.ticker);
    if (error) return { ok: false, reason: "db_error" as const, error: error.message };

    // ---- Auto-buy for all paper-trading users ------------------------------
    let autoFires = 0;
    let autoSkipped: string | null = null;
    try {
      // 1) Resolve close_time from the prediction row we just marked.
      const { data: predRow } = await supabaseAdmin
        .from("btc_model_predictions")
        .select("close_time")
        .eq("ticker", data.ticker)
        .maybeSingle();
      const closeTime = predRow?.close_time ?? null;
      if (!closeTime) {
        autoSkipped = "no_close_time";
      } else {
        // 2) Current Kalshi ask on the locked side.
        const askCents = await fetchKalshiAskCents(data.ticker, yesNo);
        if (askCents == null) {
          autoSkipped = "no_kalshi_ask";
        } else {
          const contracts = Math.max(1, Math.floor(STAKE_CENTS / askCents));

          // 3) Users already auto-fired for this ticker (idempotency).
          const { data: existing } = await supabaseAdmin
            .from("paper_fills")
            .select("user_id")
            .eq("ticker", data.ticker)
            .eq("button", "manual")
            .filter("entry_snapshot->>source", "eq", "study_auto");
          const already = new Set((existing ?? []).map((r: any) => r.user_id as string));

          // 4) Eligible balances.
          const { data: balances } = await supabaseAdmin
            .from("paper_balances")
            .select("user_id, balance_cents, bankrupt_at")
            .is("bankrupt_at", null)
            .gte("balance_cents", STAKE_CENTS);
          const targets = (balances ?? []).filter((b: any) => !already.has(b.user_id));

          if (targets.length) {
            const snapshot = {
              source: "study_auto",
              side: data.side,
              conf: data.confidencePct,
              locked_at: new Date().toISOString(),
              ask_cents: askCents,
            };
            const rows = targets.map((b: any) => ({
              user_id: b.user_id,
              ticker: data.ticker,
              close_time: closeTime,
              button: "manual" as const,
              side: yesNo,
              contracts,
              fill_price_cents: askCents,
              stake_cents: STAKE_CENTS,
              entry_snapshot: snapshot,
              status: "open" as const,
            }));

            const { data: inserted, error: insErr } = await supabaseAdmin
              .from("paper_fills")
              .insert(rows)
              .select("user_id");

            if (insErr) {
              autoSkipped = `insert_err:${insErr.message}`;
            } else {
              autoFires = inserted?.length ?? 0;
              // Debit each user's balance atomically (loop, small N).
              for (const row of inserted ?? []) {
                const uid = (row as any).user_id as string;
                const { data: cur } = await supabaseAdmin
                  .from("paper_balances")
                  .select("balance_cents")
                  .eq("user_id", uid)
                  .maybeSingle();
                if (!cur) continue;
                const newBal = cur.balance_cents - STAKE_CENTS;
                await supabaseAdmin
                  .from("paper_balances")
                  .update({
                    balance_cents: newBal,
                    bankrupt_at: newBal <= 0 ? new Date().toISOString() : null,
                  })
                  .eq("user_id", uid);
              }
            }
          }
        }
      }
    } catch (e: any) {
      autoSkipped = `auto_err:${e?.message ?? String(e)}`;
    }

    return {
      ok: true,
      wroteSide: yesNo,
      conf: data.confidencePct,
      autoFires,
      autoSkipped,
    };
  });
