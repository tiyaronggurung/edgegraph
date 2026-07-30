// Server-only: persist the Kalshi book economics for each 15m BTC window.
// Called every minute by cron. Upserts on ticker so each window ends up with
// its final window-to-date taker flow, cost basis, payout liability and
// house P/L. Settlement backfills the realized outcome + realized house P/L.
import { getKalshiImpliedSpot } from "./kalshiImpliedSpot.functions";

export async function snapshotKalshiBook(): Promise<{ ok: boolean; ticker?: string; error?: string }> {
  const snap = await getKalshiImpliedSpot();
  if (!snap.ok || !snap.ticker) return { ok: false, error: snap.error ?? "no market" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / 900_000) * 900_000).toISOString();
  const closeTime =
    snap.secondsToClose != null ? new Date(nowMs + snap.secondsToClose * 1000).toISOString() : null;

  const row = {
    ticker: snap.ticker,
    window_start: windowStart,
    close_time: closeTime,
    strike: snap.strike,
    yes_vol: snap.yesVolWindow,
    no_vol: snap.noVolWindow,
    trade_count: snap.tradeCountWindow,
    yes_cost: snap.yesCostWindow,
    no_cost: snap.noCostWindow,
    yes_avg_cents: snap.yesAvgCents,
    no_avg_cents: snap.noAvgCents,
    yes_payout: snap.yesPayout,
    no_payout: snap.noPayout,
    total_collected: snap.totalCostWindow,
    house_if_yes: snap.houseIfYes,
    house_if_no: snap.houseIfNo,
    house_lean: snap.houseLean,
    last_seen_at: new Date(nowMs).toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("kalshi_book_ledger")
    .upsert(row, { onConflict: "ticker" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ticker: snap.ticker };
}

/** Backfill outcome + realized house P/L for closed windows. */
export async function settleKalshiBook(): Promise<{ settled: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pending } = await supabaseAdmin
    .from("kalshi_book_ledger")
    .select("ticker, house_if_yes, house_if_no")
    .is("outcome", null)
    .lt("close_time", new Date(Date.now() - 60_000).toISOString())
    .order("close_time", { ascending: false })
    .limit(200);
  if (!pending?.length) return { settled: 0 };

  const tickers = pending.map((p: { ticker: string }) => p.ticker);
  const { data: preds } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, outcome")
    .in("ticker", tickers)
    .not("outcome", "is", null);
  const outcomeBy = new Map<string, string>(
    ((preds ?? []) as Array<{ ticker: string; outcome: string }>).map((p) => [p.ticker, p.outcome]),
  );

  let settled = 0;
  for (const p of pending as Array<{ ticker: string; house_if_yes: number | null; house_if_no: number | null }>) {
    const o = outcomeBy.get(p.ticker);
    if (o !== "YES" && o !== "NO") continue;
    const pnl = o === "YES" ? p.house_if_yes : p.house_if_no;
    const { error } = await supabaseAdmin
      .from("kalshi_book_ledger")
      .update({ outcome: o, house_pnl: pnl, settled_at: new Date().toISOString() })
      .eq("ticker", p.ticker);
    if (!error) settled += 1;
  }
  return { settled };
}
