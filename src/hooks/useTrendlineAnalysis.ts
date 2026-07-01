// Trendline + Fibonacci analysis for BTC over the last ~30 min of ticks.
//
// Pipeline:
//   1. Bucket ticks into 1m candles.
//   2. Find swing pivots (fractal-style: local max/min over 5-bar window).
//   3. Fit a descending upper trendline through the last 2-3 swing highs and
//      an ascending lower trendline through the last 2-3 swing lows.
//   4. Identify the dominant swing (highest high → lowest low or vice versa)
//      in the last ~15 min and compute Fibonacci retracement levels.
//   5. Derive a bias:
//        • bull  — price is riding the lower trendline up, above 0.5 fib
//        • bear  — price is riding the upper trendline down, below 0.5 fib
//        • neutral — inside the wedge / no clean structure
//
// Pure function of ticks + now(); no React, safe to reuse client-side and in
// a chart renderer.

import { useMemo } from "react";
import { useBinanceBtcTicks, type BtcTick } from "./useBinanceBtcTicks";

export interface Candle { t: number; o: number; h: number; l: number; c: number }
export interface Trendline { p0: { t: number; y: number }; p1: { t: number; y: number }; slopePerMin: number }
export interface FibLevels {
  swingHigh: number;
  swingLow: number;
  swingHighT: number;
  swingLowT: number;
  direction: "up" | "down";  // dominant swing direction (down = high→low, retrace up)
  levels: Array<{ label: string; ratio: number; price: number }>;
}

export interface TrendlineAnalysis {
  ready: boolean;
  candles: Candle[];
  price: number | null;

  supportLine: Trendline | null;
  resistanceLine: Trendline | null;

  fib: FibLevels | null;

  bias: "bull" | "bear" | "neutral";
  confidence: number;   // 0..100
  targetUp: number | null;
  targetDown: number | null;
  reason: string;
}

function buildCandles(ticks: BtcTick[], intervalMs: number): Candle[] {
  if (!ticks.length) return [];
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curStart = 0;
  for (const t of ticks) {
    const bucketStart = Math.floor(t.t / intervalMs) * intervalMs;
    if (!cur || bucketStart !== curStart) {
      if (cur) out.push(cur);
      curStart = bucketStart;
      cur = { t: bucketStart, o: t.p, h: t.p, l: t.p, c: t.p };
    }
    cur.h = Math.max(cur.h, t.p);
    cur.l = Math.min(cur.l, t.p);
    cur.c = t.p;
  }
  if (cur) out.push(cur);
  return out;
}

function findPivots(candles: Candle[], radius = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = radius; i < candles.length - radius; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

// Least-squares line through the highest 3 pivot values (or fewer if that's
// all we have). Returns null when we don't have ≥2 pivots.
function fitLine(candles: Candle[], pivotIdxs: number[], useHigh: boolean): Trendline | null {
  if (pivotIdxs.length < 2) return null;
  // Take last 3 pivots for freshness.
  const idxs = pivotIdxs.slice(-3);
  const xs = idxs.map(i => candles[i].t);
  const ys = idxs.map(i => useHigh ? candles[i].h : candles[i].l);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const t0 = xs[0];
  const t1 = xs[xs.length - 1];
  return {
    p0: { t: t0, y: slope * t0 + intercept },
    p1: { t: t1, y: slope * t1 + intercept },
    slopePerMin: slope * 60_000,
  };
}

function lineAt(line: Trendline, t: number): number {
  const dt = line.p1.t - line.p0.t;
  if (dt === 0) return line.p0.y;
  return line.p0.y + ((t - line.p0.t) / dt) * (line.p1.y - line.p0.y);
}

function computeFib(candles: Candle[]): FibLevels | null {
  if (candles.length < 6) return null;
  // Consider only the last 15 candles for the dominant swing.
  const recent = candles.slice(-15);
  let hiIdx = 0, loIdx = 0;
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].h > recent[hiIdx].h) hiIdx = i;
    if (recent[i].l < recent[loIdx].l) loIdx = i;
  }
  const swingHigh = recent[hiIdx].h;
  const swingLow = recent[loIdx].l;
  if (swingHigh - swingLow <= 0) return null;
  const direction: "up" | "down" = hiIdx > loIdx ? "up" : "down";
  const range = swingHigh - swingLow;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const levels = ratios.map(r => ({
    label: `${(r * 100).toFixed(1)}%`,
    ratio: r,
    // For an up-swing (low→high), retracement levels count DOWN from high.
    // For a down-swing (high→low), retracement levels count UP from low.
    price: direction === "up" ? swingHigh - range * r : swingLow + range * r,
  }));
  return {
    swingHigh, swingLow,
    swingHighT: recent[hiIdx].t,
    swingLowT: recent[loIdx].t,
    direction,
    levels,
  };
}

export function computeTrendlineAnalysis(ticks: BtcTick[]): TrendlineAnalysis {
  const candles = buildCandles(ticks, 60_000);
  const empty: TrendlineAnalysis = {
    ready: false, candles, price: null,
    supportLine: null, resistanceLine: null, fib: null,
    bias: "neutral", confidence: 0,
    targetUp: null, targetDown: null,
    reason: "warming up",
  };
  if (candles.length < 8) return empty;

  const price = candles[candles.length - 1].c;
  const now = candles[candles.length - 1].t;
  const { highs, lows } = findPivots(candles, 2);
  const resistanceLine = fitLine(candles, highs, true);
  const supportLine = fitLine(candles, lows, false);
  const fib = computeFib(candles);

  // Extend both lines out to "now" for signal computation.
  const resAtNow = resistanceLine ? lineAt(resistanceLine, now) : null;
  const supAtNow = supportLine ? lineAt(supportLine, now) : null;

  // Distance from price to each line, in bps
  const resDistBps = resAtNow != null ? ((resAtNow - price) / price) * 10_000 : null;
  const supDistBps = supAtNow != null ? ((price - supAtNow) / price) * 10_000 : null;

  // Bias logic:
  //   • bull if support ascending AND price above fib 0.5 AND close to support
  //     (bouncing) OR price broke resistance (positive resDist < 0)
  //   • bear if resistance descending AND price below fib 0.5 AND close to res
  //     OR price broke support (positive supDist < 0)
  let bias: "bull" | "bear" | "neutral" = "neutral";
  let confidence = 50;
  const notes: string[] = [];
  const fibMid = fib ? (fib.direction === "up"
    ? fib.swingHigh - (fib.swingHigh - fib.swingLow) * 0.5
    : fib.swingLow + (fib.swingHigh - fib.swingLow) * 0.5) : null;

  const supAsc = supportLine ? supportLine.slopePerMin > 0 : false;
  const resDesc = resistanceLine ? resistanceLine.slopePerMin < 0 : false;

  if (resDistBps != null && resDistBps < -10) {
    bias = "bull"; confidence = 75;
    notes.push(`broke resistance at $${resAtNow?.toFixed(0)}`);
  } else if (supDistBps != null && supDistBps < -10) {
    bias = "bear"; confidence = 75;
    notes.push(`broke support at $${supAtNow?.toFixed(0)}`);
  } else if (supAsc && supDistBps != null && supDistBps < 8 && fibMid != null && price > fibMid) {
    bias = "bull"; confidence = 65;
    notes.push(`bouncing off ascending support`);
  } else if (resDesc && resDistBps != null && resDistBps < 8 && fibMid != null && price < fibMid) {
    bias = "bear"; confidence = 65;
    notes.push(`rejecting descending resistance`);
  } else if (supAsc && resDesc) {
    bias = "neutral"; confidence = 40;
    notes.push("wedge — awaiting break");
  } else if (fib) {
    if (price > (fibMid ?? price)) { bias = "bull"; confidence = 55; notes.push("above fib 0.5"); }
    else { bias = "bear"; confidence = 55; notes.push("below fib 0.5"); }
  }

  // Targets: nearest fib level in the bias direction.
  let targetUp: number | null = null;
  let targetDown: number | null = null;
  if (fib) {
    const above = fib.levels.map(l => l.price).filter(p => p > price).sort((a, b) => a - b);
    const below = fib.levels.map(l => l.price).filter(p => p < price).sort((a, b) => b - a);
    targetUp = above[0] ?? null;
    targetDown = below[0] ?? null;
  }

  return {
    ready: true, candles, price,
    supportLine, resistanceLine, fib,
    bias, confidence,
    targetUp, targetDown,
    reason: notes.join(" · ") || "no clean structure",
  };
}

export function useTrendlineAnalysis(): TrendlineAnalysis {
  const { ticks } = useBinanceBtcTicks();
  return useMemo(() => computeTrendlineAnalysis(ticks), [ticks]);
}
