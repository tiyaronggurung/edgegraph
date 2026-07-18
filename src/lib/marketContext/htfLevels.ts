// HTF Support/Resistance zone clustering. Pure math.
// Scans swing pivots on 15m + 1h + 4h, clusters nearby pivots into zones,
// scores by touch count, returns nearest support/resistance to current price.

import type { Candle } from "./indicators";

export interface SrZone {
  price: number;
  touches: number;
  tf: "15m" | "1h" | "4h";
  kind: "support" | "resistance";
}

const PIVOT_N = 2;

function findPivots(candles: Candle[]): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = PIVOT_N; i < candles.length - PIVOT_N; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= PIVOT_N; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(c.h);
    if (isLow) lows.push(c.l);
  }
  return { highs, lows };
}

/**
 * Cluster raw pivot prices into zones. Two prices belong to the same zone when
 * they are within `tolerancePct` of each other (default 0.15%).
 */
function clusterPrices(prices: number[], tolerancePct = 0.0015): { price: number; touches: number }[] {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const zones: { price: number; touches: number }[] = [];
  let bucket: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    const anchor = bucket[0];
    if (Math.abs(p - anchor) / anchor <= tolerancePct) {
      bucket.push(p);
    } else {
      const avg = bucket.reduce((a, v) => a + v, 0) / bucket.length;
      zones.push({ price: avg, touches: bucket.length });
      bucket = [p];
    }
  }
  const avg = bucket.reduce((a, v) => a + v, 0) / bucket.length;
  zones.push({ price: avg, touches: bucket.length });
  return zones;
}

export function computeSrZones(
  c15m: Candle[],
  c1h: Candle[],
  c4h: Candle[],
): SrZone[] {
  const out: SrZone[] = [];
  const push = (tf: SrZone["tf"], candles: Candle[]) => {
    const { highs, lows } = findPivots(candles);
    for (const z of clusterPrices(highs)) {
      if (z.touches >= 1) out.push({ price: z.price, touches: z.touches, tf, kind: "resistance" });
    }
    for (const z of clusterPrices(lows)) {
      if (z.touches >= 1) out.push({ price: z.price, touches: z.touches, tf, kind: "support" });
    }
  };
  if (c15m.length > PIVOT_N * 2 + 1) push("15m", c15m);
  if (c1h.length > PIVOT_N * 2 + 1) push("1h", c1h);
  if (c4h.length > PIVOT_N * 2 + 1) push("4h", c4h);
  return out;
}

export interface NearestSr {
  support: SrZone | null;
  resistance: SrZone | null;
}

/**
 * Nearest support (below price) and resistance (above price). Ties broken by
 * higher touch count, then higher timeframe.
 */
export function nearestSr(zones: SrZone[], price: number): NearestSr {
  const tfRank: Record<SrZone["tf"], number> = { "15m": 1, "1h": 2, "4h": 3 };
  const supports = zones.filter((z) => z.kind === "support" && z.price < price);
  const resistances = zones.filter((z) => z.kind === "resistance" && z.price > price);
  supports.sort((a, b) => {
    const d = Math.abs(price - a.price) - Math.abs(price - b.price);
    if (Math.abs(d) > 1) return d;
    if (b.touches !== a.touches) return b.touches - a.touches;
    return tfRank[b.tf] - tfRank[a.tf];
  });
  resistances.sort((a, b) => {
    const d = Math.abs(price - a.price) - Math.abs(price - b.price);
    if (Math.abs(d) > 1) return d;
    if (b.touches !== a.touches) return b.touches - a.touches;
    return tfRank[b.tf] - tfRank[a.tf];
  });
  return {
    support: supports[0] ?? null,
    resistance: resistances[0] ?? null,
  };
}
