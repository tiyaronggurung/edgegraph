import { useMemo } from "react";
import { useBinanceBtcTicks, type BtcTick } from "./useBinanceBtcTicks";

// "Chart-reading" verdict computed from live Binance aggTrade ticks.
//
// Score is 0..100 where 50 = neutral. > 50 = bullish bias, < 50 = bearish.
// Components (weighted):
//   • VWAP bias         (25%)  price vs 15-min VWAP
//   • Momentum RSI(14)  (20%)  on 1m closes
//   • Order-flow ratio  (20%)  buy vol / (buy+sell) last 3m
//   • Micro-trend       (20%)  count of green vs red in last 5 × 1m candles
//   • Rejection wick    (15%)  last 1m candle wick vs body direction
//
// Also reports nearest support/resistance from swing pivots in last 30 min
// so the user knows if a strike sits on a real level.

export interface ChartVerdict {
  ready: boolean;
  connected: boolean;
  samples: number;
  score: number;             // 0..100
  bias: "up" | "down" | "flat";
  strength: "strong" | "moderate" | "weak" | "chop";
  vwap: number | null;
  vwapDeltaUsd: number | null;
  vwapDeltaPct: number | null;
  rsi: number | null;
  buyRatio: number | null;   // 0..1
  greenCount: number;        // out of last 5 candles
  lastCandle: { o: number; h: number; l: number; c: number } | null;
  wickBias: "up" | "down" | "neutral";
  support: number | null;
  resistance: number | null;
  reason: string;
}

interface Candle { o: number; h: number; l: number; c: number; v: number; buyV: number; t0: number; t1: number }

function buildCandles(ticks: BtcTick[], intervalMs: number, maxCandles: number): Candle[] {
  if (!ticks.length) return [];
  const now = ticks[ticks.length - 1].t;
  const start = now - intervalMs * maxCandles;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const t of ticks) {
    if (t.t < start) continue;
    const bucketStart = Math.floor(t.t / intervalMs) * intervalMs;
    if (!cur || cur.t0 !== bucketStart) {
      if (cur) out.push(cur);
      cur = { o: t.p, h: t.p, l: t.p, c: t.p, v: 0, buyV: 0, t0: bucketStart, t1: bucketStart + intervalMs };
    }
    cur.h = Math.max(cur.h, t.p);
    cur.l = Math.min(cur.l, t.p);
    cur.c = t.p;
    cur.v += t.q;
    if (!t.m) cur.buyV += t.q; // m=false → buyer is taker → market-buy
  }
  if (cur) out.push(cur);
  return out;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (gains + losses === 0) return 50;
  const rs = (gains / period) / Math.max(1e-9, losses / period);
  return 100 - 100 / (1 + rs);
}

function findSupportResistance(candles: Candle[], price: number): { support: number | null; resistance: number | null } {
  if (candles.length < 5) return { support: null, resistance: null };
  const pivotsHi: number[] = [];
  const pivotsLo: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    if (h >= candles[i-1].h && h >= candles[i-2].h && h >= candles[i+1].h && h >= candles[i+2].h) pivotsHi.push(h);
    if (l <= candles[i-1].l && l <= candles[i-2].l && l <= candles[i+1].l && l <= candles[i+2].l) pivotsLo.push(l);
  }
  const support = pivotsLo.filter(x => x < price).sort((a,b) => b - a)[0] ?? null;
  const resistance = pivotsHi.filter(x => x > price).sort((a,b) => a - b)[0] ?? null;
  return { support, resistance };
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

export function useChartVerdict(): ChartVerdict {
  const { ticks, connected, count } = useBinanceBtcTicks();

  return useMemo<ChartVerdict>(() => {
    const empty: ChartVerdict = {
      ready: false, connected, samples: count,
      score: 50, bias: "flat", strength: "chop",
      vwap: null, vwapDeltaUsd: null, vwapDeltaPct: null,
      rsi: null, buyRatio: null, greenCount: 0,
      lastCandle: null, wickBias: "neutral",
      support: null, resistance: null,
      reason: connected ? "warming up — collecting ticks…" : "chart feed offline",
    };
    if (!ticks.length) return empty;

    const now = ticks[ticks.length - 1].t;
    const price = ticks[ticks.length - 1].p;

    // 15-min VWAP
    const vwapCutoff = now - 15 * 60_000;
    let pv = 0, vv = 0;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i];
      if (t.t < vwapCutoff) break;
      pv += t.p * t.q;
      vv += t.q;
    }
    const vwap = vv > 0 ? pv / vv : null;
    const vwapDeltaUsd = vwap != null ? price - vwap : null;
    const vwapDeltaPct = vwap != null ? ((price - vwap) / vwap) * 100 : null;

    // 1m candles for RSI + micro-trend + wick + S/R
    const candles1m = buildCandles(ticks, 60_000, 30);
    const closes = candles1m.map(c => c.c);
    const rsiVal = rsi(closes, 14);

    const last5 = candles1m.slice(-5);
    const greenCount = last5.filter(c => c.c >= c.o).length;

    // Buy/sell pressure last 3m
    const bpCutoff = now - 3 * 60_000;
    let buyV = 0, sellV = 0;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i];
      if (t.t < bpCutoff) break;
      if (t.m) sellV += t.q; else buyV += t.q;
    }
    const buyRatio = (buyV + sellV) > 0 ? buyV / (buyV + sellV) : null;

    // Wick bias on latest 1m candle
    const last = candles1m[candles1m.length - 1] ?? null;
    let wickBias: "up" | "down" | "neutral" = "neutral";
    if (last) {
      const body = Math.abs(last.c - last.o);
      const upperWick = last.h - Math.max(last.o, last.c);
      const lowerWick = Math.min(last.o, last.c) - last.l;
      if (lowerWick > body * 1.5 && lowerWick > upperWick) wickBias = "up";      // rejection below → bullish
      else if (upperWick > body * 1.5 && upperWick > lowerWick) wickBias = "down"; // rejection above → bearish
    }

    // Support / resistance
    const { support, resistance } = findSupportResistance(candles1m, price);

    // Score components (each maps to 0..100 signed around 50).
    const s_vwap = vwapDeltaPct != null ? clamp(50 + vwapDeltaPct * 500, 0, 100) : 50; // 0.1% off VWAP → +50
    const s_rsi = rsiVal != null ? clamp(rsiVal, 0, 100) : 50;
    const s_flow = buyRatio != null ? clamp(50 + (buyRatio - 0.5) * 200, 0, 100) : 50;
    const s_trend = clamp(20 + greenCount * 15, 0, 100); // 0→20, 5→95
    const s_wick = wickBias === "up" ? 75 : wickBias === "down" ? 25 : 50;

    const readyEnough = ticks.length > 50 && candles1m.length >= 5;
    if (!readyEnough) return { ...empty, connected, samples: count, vwap, vwapDeltaUsd, vwapDeltaPct, reason: `warming up — ${count} ticks, ${candles1m.length}/5 candles` };

    const score = clamp(
      s_vwap * 0.25 +
      s_rsi  * 0.20 +
      s_flow * 0.20 +
      s_trend * 0.20 +
      s_wick * 0.15,
      0, 100,
    );

    const skew = score - 50;
    const bias: "up" | "down" | "flat" = Math.abs(skew) < 5 ? "flat" : skew > 0 ? "up" : "down";
    const strength: "strong" | "moderate" | "weak" | "chop" =
      Math.abs(skew) >= 20 ? "strong" :
      Math.abs(skew) >= 12 ? "moderate" :
      Math.abs(skew) >= 5  ? "weak" : "chop";

    const parts: string[] = [];
    if (vwapDeltaUsd != null) parts.push(`VWAP ${vwapDeltaUsd >= 0 ? "+" : ""}$${vwapDeltaUsd.toFixed(0)}`);
    if (rsiVal != null) parts.push(`RSI ${rsiVal.toFixed(0)}`);
    if (buyRatio != null) parts.push(`buy ${(buyRatio*100).toFixed(0)}%`);
    parts.push(`${greenCount}/5 grn`);
    if (wickBias !== "neutral") parts.push(`${wickBias === "up" ? "▼wick" : "▲wick"}`);
    if (support && resistance) parts.push(`S $${support.toFixed(0)} / R $${resistance.toFixed(0)}`);

    return {
      ready: true, connected, samples: count,
      score, bias, strength,
      vwap, vwapDeltaUsd, vwapDeltaPct,
      rsi: rsiVal, buyRatio, greenCount,
      lastCandle: last ? { o: last.o, h: last.h, l: last.l, c: last.c } : null,
      wickBias, support, resistance,
      reason: parts.join(" · "),
    };
  }, [ticks, connected, count]);
}
