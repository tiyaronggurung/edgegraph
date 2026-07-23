import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectTrendlines, detectSpike, type TCandle } from "@/lib/ta/trendlines";

// Server fn: fetches last ~90m of BTC 1m candles, computes trendlines +
// rule-(c) spike, logs a snapshot to btc_trendline_shadow, and returns
// data for the client mini-chart. Shadow only — no trading impact.

export interface TrendlineSnapshot {
  ok: boolean;
  candles: TCandle[];
  ticker: string | null;
  strike: number | null;
  spot: number | null;
  upperAtNow: number | null;
  lowerAtNow: number | null;
  upperStart: number | null;
  lowerStart: number | null;
  channelWidthPct: number | null;
  distToUpperPct: number | null;
  distToLowerPct: number | null;
  isWedge: boolean;
  wedgeBias: "bull" | "bear" | "sym" | null;
  spikeDetected: boolean;
  spikeDirection: "up" | "down" | null;
  spikeBodyRatio: number;
  spikeBreakPct: number;
  swingsUsed: number;
  loggedId: string | null;
  error: string | null;
}

async function fetchBinance1m(limit = 90): Promise<TCandle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((row) => {
    const r = row as [number, string, string, string, string, string];
    return {
      t: Number(r[0]),
      o: parseFloat(r[1]),
      h: parseFloat(r[2]),
      l: parseFloat(r[3]),
      c: parseFloat(r[4]),
    };
  });
}

export const evalTrendlineShadow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TrendlineSnapshot> => {
    const empty: TrendlineSnapshot = {
      ok: false, candles: [], ticker: null, strike: null, spot: null,
      upperAtNow: null, lowerAtNow: null, upperStart: null, lowerStart: null,
      channelWidthPct: null, distToUpperPct: null, distToLowerPct: null,
      isWedge: false, wedgeBias: null,
      spikeDetected: false, spikeDirection: null,
      spikeBodyRatio: 0, spikeBreakPct: 0,
      swingsUsed: 0, loggedId: null, error: null,
    };

    let candles: TCandle[];
    try {
      candles = await fetchBinance1m(90);
    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
    if (candles.length < 20) return { ...empty, candles, error: "insufficient candles" };

    const trend = detectTrendlines(candles);
    const spike = detectSpike(candles, trend);
    const last = candles[candles.length - 1];
    const first = candles[0];

    // Latest tape row for ticker/strike/stc context (best-effort).
    const { data: tapeRows } = await context.supabase
      .from("btc_odds_tape")
      .select("ticker,strike,spot,seconds_to_close,snapped_at")
      .order("snapped_at", { ascending: false })
      .limit(1);
    const tape = (tapeRows ?? [])[0] as
      | { ticker: string; strike: number; spot: number; seconds_to_close: number; snapped_at: string }
      | undefined;

    // Log the snapshot (upsert-ish: one row per minute per user).
    let loggedId: string | null = null;
    try {
      const { data: ins } = await context.supabase
        .from("btc_trendline_shadow")
        .insert({
          user_id: context.userId,
          ticker: tape?.ticker ?? "BTCUSDT",
          spot: last.c,
          strike: tape?.strike ?? null,
          seconds_to_close: tape?.seconds_to_close ?? null,
          upper_slope: trend.upper?.slope ?? null,
          upper_intercept: trend.upper?.intercept ?? null,
          lower_slope: trend.lower?.slope ?? null,
          lower_intercept: trend.lower?.intercept ?? null,
          upper_price_now: trend.upperAtNow,
          lower_price_now: trend.lowerAtNow,
          dist_to_upper_pct: trend.distToUpperPct,
          dist_to_lower_pct: trend.distToLowerPct,
          channel_width_pct: trend.channelWidthPct,
          is_wedge: trend.isWedge,
          wedge_bias: trend.wedgeBias,
          spike_detected: spike.detected,
          spike_direction: spike.direction,
          spike_body_ratio: spike.bodyRatio,
          spike_break_pct: spike.breakPct,
          swings_used: trend.swingsUsed,
        })
        .select("id")
        .single();
      loggedId = (ins as { id: string } | null)?.id ?? null;
    } catch {
      // don't fail the request if logging hiccups
    }

    return {
      ok: true,
      candles,
      ticker: tape?.ticker ?? null,
      strike: tape?.strike ?? null,
      spot: last.c,
      upperAtNow: trend.upperAtNow,
      lowerAtNow: trend.lowerAtNow,
      upperStart: trend.upper ? trend.upper.slope * first.t + trend.upper.intercept : null,
      lowerStart: trend.lower ? trend.lower.slope * first.t + trend.lower.intercept : null,
      channelWidthPct: trend.channelWidthPct,
      distToUpperPct: trend.distToUpperPct,
      distToLowerPct: trend.distToLowerPct,
      isWedge: trend.isWedge,
      wedgeBias: trend.wedgeBias,
      spikeDetected: spike.detected,
      spikeDirection: spike.direction,
      spikeBodyRatio: spike.bodyRatio,
      spikeBreakPct: spike.breakPct,
      swingsUsed: trend.swingsUsed,
      loggedId,
      error: null,
    };
  });
