// Support/Resistance detector for BTC 5m candles.
// Pivot-based level finder with touch counting, minimum time separation,
// and rejection vs breakout classification.

import type { BtcCandle } from "../cryptoBtc.functions";

export interface Level {
  price: number;
  touches: number;
  lastTouchMs: number;
  status: "rejection" | "breakout" | "untested";
  // Number of times price closed clearly beyond the level (acceptance).
  acceptanceCloses: number;
}

export interface LevelContext {
  nearestSupport: Level | null;
  nearestResistance: Level | null;
  allLevels: Level[];
}

const CLUSTER_TOLERANCE_USD = 40;    // group pivots within $40 as one level
const MIN_TOUCH_SEPARATION_MS = 5 * 60 * 1000; // 5 minutes between valid touches
const PIVOT_LOOKBACK = 3;            // bars each side for a local pivot
const TOUCH_PROXIMITY_USD = 60;      // count as a touch within $60
const ACCEPTANCE_BODY_USD = 25;      // close beyond level by ≥$25 = acceptance

function findPivots(candles: BtcCandle[]): Array<{ price: number; t: number; kind: "high" | "low" }> {
  const out: Array<{ price: number; t: number; kind: "high" | "low" }> = [];
  for (let i = PIVOT_LOOKBACK; i < candles.length - PIVOT_LOOKBACK; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= PIVOT_LOOKBACK; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
    }
    if (isHigh) out.push({ price: c.h, t: c.t, kind: "high" });
    if (isLow) out.push({ price: c.l, t: c.t, kind: "low" });
  }
  return out;
}

function clusterLevels(
  pivots: Array<{ price: number; t: number; kind: "high" | "low" }>,
  candles: BtcCandle[],
): Level[] {
  if (pivots.length === 0) return [];
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Array<{ prices: number[]; times: number[] }> = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price - last.prices[last.prices.length - 1]) <= CLUSTER_TOLERANCE_USD) {
      last.prices.push(p.price);
      last.times.push(p.t);
    } else {
      clusters.push({ prices: [p.price], times: [p.t] });
    }
  }

  const levels: Level[] = clusters.map((c) => {
    const price = c.prices.reduce((s, v) => s + v, 0) / c.prices.length;
    // Count validated touches across ALL candles (not just pivots): high or low within proximity,
    // with min separation.
    const touchTimes: number[] = [];
    for (const k of candles) {
      const near = Math.min(Math.abs(k.h - price), Math.abs(k.l - price)) <= TOUCH_PROXIMITY_USD;
      if (!near) continue;
      const last = touchTimes[touchTimes.length - 1];
      if (last === undefined || k.t - last >= MIN_TOUCH_SEPARATION_MS) touchTimes.push(k.t);
    }
    // Acceptance = candles that closed clearly beyond the level (either side)
    let acceptanceCloses = 0;
    let aboveCloses = 0, belowCloses = 0;
    for (const k of candles) {
      if (k.c >= price + ACCEPTANCE_BODY_USD) { acceptanceCloses++; aboveCloses++; }
      else if (k.c <= price - ACCEPTANCE_BODY_USD) { acceptanceCloses++; belowCloses++; }
    }
    // Classify: if touches ≥3 without decisive acceptance-through → rejection.
    // If price accepted through decisively (majority of recent closes on the opposite side of original) → breakout.
    let status: Level["status"] = "untested";
    if (touchTimes.length >= 3) status = "rejection";
    // If a strong majority of the last ~20 closes are on the opposite side, treat as broken.
    const recent = candles.slice(-20);
    const recentAbove = recent.filter((k) => k.c >= price + ACCEPTANCE_BODY_USD).length;
    const recentBelow = recent.filter((k) => k.c <= price - ACCEPTANCE_BODY_USD).length;
    if (recent.length >= 15 && (recentAbove >= 14 || recentBelow >= 14) && acceptanceCloses >= 8) {
      status = "breakout";
    }
    return {
      price,
      touches: touchTimes.length,
      lastTouchMs: touchTimes[touchTimes.length - 1] ?? c.times[c.times.length - 1],
      status,
      acceptanceCloses,
    };
  });

  // Keep levels with ≥2 touches so we don't drown in noise.
  return levels.filter((l) => l.touches >= 2);
}

export function detectLevels(candles5m: BtcCandle[], spot: number): LevelContext {
  if (candles5m.length < 20) {
    return { nearestSupport: null, nearestResistance: null, allLevels: [] };
  }
  const pivots = findPivots(candles5m);
  const levels = clusterLevels(pivots, candles5m);

  // Nearest support = highest level below spot that is NOT a broken-up breakout
  // (a broken level acts as flip; we still track it but classify status).
  const below = levels.filter((l) => l.price < spot).sort((a, b) => b.price - a.price);
  const above = levels.filter((l) => l.price > spot).sort((a, b) => a.price - b.price);

  return {
    nearestSupport: below[0] ?? null,
    nearestResistance: above[0] ?? null,
    allLevels: levels,
  };
}

// Range percentile: where does spot sit in [low, high] of the window? 0=low, 100=high.
export function rangePercentile(candles: BtcCandle[], spot: number): number | null {
  if (candles.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return null;
  return Math.max(0, Math.min(100, ((spot - lo) / (hi - lo)) * 100));
}

// Simple directional bias: EMA slope over the window.
export function biasFromCandles(candles: BtcCandle[]): "bull" | "bear" | "flat" {
  if (candles.length < 10) return "flat";
  const closes = candles.map((c) => c.c);
  const first = closes.slice(0, Math.floor(closes.length / 3)).reduce((s, v) => s + v, 0) / Math.floor(closes.length / 3);
  const last = closes.slice(-Math.floor(closes.length / 3)).reduce((s, v) => s + v, 0) / Math.floor(closes.length / 3);
  const delta = (last - first) / first;
  if (delta > 0.003) return "bull";
  if (delta < -0.003) return "bear";
  return "flat";
}

// Micro-structure classifier over the last N candles: HH/HL = bull, LH/LL = bear.
export function structureBias(candles: BtcCandle[], n = 10): "bull" | "bear" | "flat" {
  if (candles.length < n) return "flat";
  const slice = candles.slice(-n);
  let up = 0, down = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].h > slice[i - 1].h && slice[i].l > slice[i - 1].l) up++;
    else if (slice[i].h < slice[i - 1].h && slice[i].l < slice[i - 1].l) down++;
  }
  if (up - down >= 3) return "bull";
  if (down - up >= 3) return "bear";
  return "flat";
}

// True Range → ATR
export function atr(candles: BtcCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

// Session VWAP (rolling — use provided candles as the "session").
export function vwap(candles: BtcCandle[]): number | null {
  if (candles.length === 0) return null;
  let pv = 0, vv = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * (c.v || 1);
    vv += c.v || 1;
  }
  return vv > 0 ? pv / vv : null;
}
