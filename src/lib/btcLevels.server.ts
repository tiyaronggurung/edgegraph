// Server-only helper: computes the public BTC buy / mid / sell levels from
// 1m candles using the same trendline engine the dashboard uses.
//
// buy  = lower trendline (support)  — where we want to be a buyer
// sell = upper trendline (resistance)
// mid  = (buy + sell) / 2           — the pivot our study logic keys off
//
// No auth, no DB writes. Cached in-memory for a few seconds so an external
// consumer polling fast doesn't hammer the exchange APIs.

import { detectTrendlines, detectSpike, type TCandle } from "@/lib/ta/trendlines";

export interface BtcLevels {
  ok: boolean;
  asOf: string;              // ISO timestamp of computation
  source: string;            // candle source used
  spot: number | null;
  /** Where `spot` came from: our own multi-venue composite, or a 1m candle close. */
  spotSource: "own_composite" | "candle_close" | "none";
  buy: number | null;        // lower trendline @ now
  mid: number | null;
  sell: number | null;       // upper trendline @ now
  channelWidthPct: number | null;
  distToBuyPct: number | null;
  distToSellPct: number | null;
  distToMidUsd: number | null;   // spot - mid
  position: "above_sell" | "upper_half" | "lower_half" | "below_buy" | "unknown";
  bias: "bull" | "bear" | "neutral";
  wedge: { isWedge: boolean; bias: "bull" | "bear" | "sym" | null };
  spike: { detected: boolean; direction: "up" | "down" | null; bodyRatio: number; breakPct: number };
  swingsUsed: number;
  candles?: TCandle[];
  error: string | null;
}

async function fetchBinance1m(limit: number): Promise<TCandle[]> {
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
      v: parseFloat(r[5]),
    };
  });
}

async function fetchCoinbase1m(limit: number): Promise<TCandle[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - limit * 60;
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "bettinggraph/1.0" } });
  if (!res.ok) throw new Error(`coinbase ${res.status}`);
  const raw = (await res.json()) as [number, number, number, number, number, number][];
  return raw
    .map((r) => ({ t: r[0] * 1000, o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] }))
    .sort((a, b) => a.t - b.t);
}

async function fetch1m(limit: number): Promise<{ candles: TCandle[]; source: string }> {
  try {
    const c = await fetchBinance1m(limit);
    if (c.length) return { candles: c, source: "binance" };
    throw new Error("binance empty");
  } catch (e1) {
    const c = await fetchCoinbase1m(limit);
    return { candles: c, source: `coinbase (binance: ${(e1 as Error).message})` };
  }
}

const CACHE_MS = 3_000;
let cache: { at: number; limit: number; value: BtcLevels } | null = null;

// Our own trendline composite spot (the value the crypto page shows): the
// client records the consolidated multi-venue tick into btc_spot_ticks every
// ~1-2s. That's faster than Kalshi's own reference re-quote and faster than a
// 1m candle close, so every consumer of getBtcLevels() keys off it.
const OWN_SPOT_MAX_AGE_MS = 25_000;

async function fetchOwnCompositeSpot(): Promise<{ spot: number; ageMs: number } | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("btc_spot_ticks")
      .select("spot,observed_at")
      .eq("source", "consolidated")
      .order("observed_at", { ascending: false })
      .limit(1);
    const row = data?.[0] as { spot: number | string; observed_at: string } | undefined;
    if (!row) return null;
    const spot = Number(row.spot);
    const ageMs = Date.now() - new Date(row.observed_at).getTime();
    if (!Number.isFinite(spot) || spot <= 0 || ageMs > OWN_SPOT_MAX_AGE_MS) return null;
    return { spot: Number(spot.toFixed(2)), ageMs };
  } catch {
    return null;
  }
}


export async function getBtcLevels(opts?: { limit?: number; includeCandles?: boolean }): Promise<BtcLevels> {
  const limit = Math.max(30, Math.min(500, opts?.limit ?? 300));
  const includeCandles = opts?.includeCandles === true;

  const now = Date.now();
  if (cache && cache.limit === limit && now - cache.at < CACHE_MS) {
    const v = cache.value;
    return includeCandles ? v : { ...v, candles: undefined };
  }

  const base: BtcLevels = {
    ok: false,
    asOf: new Date().toISOString(),
    source: "none",
    spot: null, buy: null, mid: null, sell: null,
    channelWidthPct: null, distToBuyPct: null, distToSellPct: null, distToMidUsd: null,
    position: "unknown",
    bias: "neutral",
    wedge: { isWedge: false, bias: null },
    spike: { detected: false, direction: null, bodyRatio: 0, breakPct: 0 },
    swingsUsed: 0,
    error: null,
  };

  let candles: TCandle[] = [];
  let source = "none";
  const ownSpotPromise = fetchOwnCompositeSpot();
  try {
    const r = await fetch1m(limit);
    candles = r.candles;
    source = r.source;
  } catch (e) {
    return { ...base, error: `candle fetch failed: ${(e as Error).message}` };
  }

  if (!candles.length) return { ...base, source, error: "no candles" };

  const trend = detectTrendlines(candles);
  const spike = detectSpike(candles, trend);
  const own = await ownSpotPromise;
  const spot = own?.spot ?? candles[candles.length - 1].c;
  const spotSource: BtcLevels["spotSource"] = own ? "own_composite" : "candle_close";

  const sell = trend.upperAtNow;
  const buy = trend.lowerAtNow;
  const mid = sell != null && buy != null ? (sell + buy) / 2 : null;

  let position: BtcLevels["position"] = "unknown";
  if (sell != null && spot > sell) position = "above_sell";
  else if (buy != null && spot < buy) position = "below_buy";
  else if (mid != null) position = spot >= mid ? "upper_half" : "lower_half";

  let bias: BtcLevels["bias"] = "neutral";
  if (position === "above_sell" || (position === "upper_half" && (trend.wedgeBias ?? "sym") !== "bear")) bias = "bull";
  else if (position === "below_buy" || (position === "lower_half" && (trend.wedgeBias ?? "sym") !== "bull")) bias = "bear";

  const value: BtcLevels = {
    ok: true,
    asOf: new Date().toISOString(),
    source,
    spot,
    buy: buy != null ? Number(buy.toFixed(2)) : null,
    mid: mid != null ? Number(mid.toFixed(2)) : null,
    sell: sell != null ? Number(sell.toFixed(2)) : null,
    channelWidthPct: trend.channelWidthPct,
    distToBuyPct: trend.distToLowerPct,
    distToSellPct: trend.distToUpperPct,
    distToMidUsd: mid != null ? Number((spot - mid).toFixed(2)) : null,
    position,
    bias,
    wedge: { isWedge: trend.isWedge, bias: trend.wedgeBias },
    spike: {
      detected: spike.detected,
      direction: spike.direction,
      bodyRatio: spike.bodyRatio,
      breakPct: spike.breakPct,
    },
    swingsUsed: trend.swingsUsed,
    candles,
    error: null,
  };

  cache = { at: now, limit, value };
  return includeCandles ? value : { ...value, candles: undefined };
}
