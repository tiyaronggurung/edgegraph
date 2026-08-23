// Public (no-auth) read-only chart data for the embeddable trendline view
// (/embed/trendline). Mirrors the authenticated candle + trendline server fns
// but performs NO database writes and NO shadow logging.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectTrendlines, detectSpike, type TCandle } from "@/lib/ta/trendlines";
import { TF_LIST, type CandleTf, type CandlesResult } from "@/lib/btcCandles.functions";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import type { TrendlineSnapshot } from "@/lib/trendlineShadow.functions";

const TF_GRANULARITY: Record<CandleTf, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86_400,
};

async function fetchCoinbase(tf: CandleTf, limit: number): Promise<TCandle[]> {
  const g = TF_GRANULARITY[tf];
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.min(300, limit) * g;
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${g}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "bettinggraph/1.0" } });
  if (!res.ok) throw new Error(`coinbase ${tf} ${res.status}`);
  const raw = (await res.json()) as [number, number, number, number, number, number][];
  return raw
    .map((r) => ({ t: r[0] * 1000, o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] }))
    .sort((a, b) => a.t - b.t)
    .slice(-limit);
}

async function fetchBinance(tf: CandleTf, limit: number): Promise<TCandle[]> {
  const iv = tf === "1h" ? "1h" : tf === "1d" ? "1d" : tf;
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${Math.min(1000, limit)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((row) => {
    const r = row as [number, string, string, string, string, string];
    return {
      t: Number(r[0]),
      o: parseFloat(r[1]), h: parseFloat(r[2]),
      l: parseFloat(r[3]), c: parseFloat(r[4]), v: parseFloat(r[5]),
    };
  });
}

async function fetchCandles(tf: CandleTf, limit: number): Promise<TCandle[]> {
  try {
    const c = await fetchBinance(tf, limit);
    if (c.length) return c;
    throw new Error("binance empty");
  } catch {
    return fetchCoinbase(tf, limit);
  }
}

const inputSchema = z.object({
  tf: z.enum(TF_LIST),
  limit: z.number().int().min(20).max(1000).default(300),
});

export const getPublicBtcCandles = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<CandlesResult> => {
    const candles = await fetchCandles(data.tf, data.limit);
    return { tf: data.tf, candles, source: "live" };
  });

export const getPublicTrendlineSnapshot = createServerFn({ method: "GET" })
  .handler(async (): Promise<TrendlineSnapshot> => {
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
      candles = await fetchCandles("1m", 300);
    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
    if (candles.length < 20) return { ...empty, candles, error: "insufficient candles" };

    const trend = detectTrendlines(candles);
    const spike = detectSpike(candles, trend);
    const last = candles[candles.length - 1];
    const first = candles[0];

    let ticker: string | null = null;
    let strike: number | null = null;
    try {
      const k = await getKalshiImpliedSpot();
      if (k?.ok) {
        ticker = k.ticker ?? null;
        strike = k.strike ?? null;
      }
    } catch {
      // best-effort context only
    }

    return {
      ok: true,
      candles,
      ticker,
      strike,
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
      loggedId: null,
      error: null,
    };
  });
