// Server-only: persist the SAME book economics the trendline chart shows
// ("COST 15m — UP avg / DN avg / pool / payout / book P/L / lean") into
// public.kalshi_book_ledger, so the Kalshi Book Ledger log reflects the real,
// full-window taker tape instead of the lighter incremental snapshot.
//
// This deliberately does NOT touch the trendline path — it reuses the exact
// same source (getKalshiImpliedSpot) and only writes the numbers down.

import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";

const r2 = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;

export async function recordTrendlineBook(): Promise<{
  ok: boolean;
  ticker?: string;
  error?: string;
}> {
  let flow: Awaited<ReturnType<typeof getKalshiImpliedSpot>>;
  try {
    flow = await getKalshiImpliedSpot();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!flow?.ok || !flow.ticker) return { ok: false, error: flow?.error ?? "no market" };
  // Only write when we actually have the window tape; otherwise leave whatever
  // the incremental snapshot already accumulated.
  if (flow.totalCostWindow == null || (flow.tradeCountWindow ?? 0) === 0) {
    return { ok: false, ticker: flow.ticker, error: "no window tape yet" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowMs = Date.now();
  const closeMs =
    flow.secondsToClose != null ? nowMs + flow.secondsToClose * 1000 : nowMs;
  const windowStartMs = Math.floor((closeMs - 1000) / 900_000) * 900_000;

  const row = {
    ticker: flow.ticker,
    window_start: new Date(windowStartMs).toISOString(),
    close_time: new Date(closeMs).toISOString(),
    strike: flow.strike,
    yes_vol: flow.yesVolWindow,
    no_vol: flow.noVolWindow,
    trade_count: flow.tradeCountWindow,
    yes_cost: r2(flow.yesCostWindow),
    no_cost: r2(flow.noCostWindow),
    yes_avg_cents: flow.yesAvgCents,
    no_avg_cents: flow.noAvgCents,
    yes_payout: r2(flow.yesPayout),
    no_payout: r2(flow.noPayout),
    total_collected: r2(flow.totalCostWindow),
    house_if_yes: r2(flow.houseIfYes),
    house_if_no: r2(flow.houseIfNo),
    house_lean: flow.houseLean,
    // Full-window recompute: no incremental cursor (see snapshotKalshiBook).
    last_trade_ts: null,
    last_seen_at: new Date(nowMs).toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("kalshi_book_ledger")
    .upsert(row, { onConflict: "ticker" });
  if (error) return { ok: false, ticker: flow.ticker, error: error.message };
  return { ok: true, ticker: flow.ticker };
}
