// Phase 2 — regime detector.
//
// Classifies the last 30 min of BTC ticks as one of:
//   trend  — price moved in a straight line: |net move| / total path > 0.55
//   chop   — path is scribbly: |net move| / total path < 0.30
//   mixed  — everything in between (default; behaves like the old static model)
//
// "Straightness" = |lastPrice - firstPrice| / sum(|Δp| over each tick step)
// ATR% = mean absolute % change per 1m candle over last 30 candles

import { useMemo } from "react";
import { useBinanceBtcTicks } from "./useBinanceBtcTicks";

export type Regime = "trend" | "chop" | "mixed";

export interface MarketRegime {
  ready: boolean;
  regime: Regime;
  straightness: number | null;  // 0..1
  atrPct: number | null;        // % per minute
  reason: string;
}

const WINDOW_MS = 30 * 60_000;

export function useMarketRegime(): MarketRegime {
  const { ticks } = useBinanceBtcTicks();
  return useMemo<MarketRegime>(() => {
    if (ticks.length < 60) {
      return { ready: false, regime: "mixed", straightness: null, atrPct: null, reason: "warming up" };
    }
    const now = ticks[ticks.length - 1].t;
    const cutoff = now - WINDOW_MS;
    let firstPrice: number | null = null;
    let lastPrice = ticks[ticks.length - 1].p;
    let path = 0;
    let prev: number | null = null;
    for (const t of ticks) {
      if (t.t < cutoff) continue;
      if (firstPrice == null) firstPrice = t.p;
      if (prev != null) path += Math.abs(t.p - prev);
      prev = t.p;
    }
    if (firstPrice == null || path <= 0) {
      return { ready: false, regime: "mixed", straightness: null, atrPct: null, reason: "insufficient window" };
    }
    const net = Math.abs(lastPrice - firstPrice);
    const straightness = Math.min(1, net / path);

    // ATR% approximation: bucket into 30 × 1m closes, avg |Δ%|
    const bucketMs = 60_000;
    const buckets: number[] = [];
    let curBucket: number = Math.floor(ticks[0].t / bucketMs);
    let curClose = ticks[0].p;
    for (const t of ticks) {
      if (t.t < cutoff) continue;
      const b = Math.floor(t.t / bucketMs);
      if (b !== curBucket) {
        buckets.push(curClose);
        curBucket = b;
      }
      curClose = t.p;
    }
    buckets.push(curClose);
    let atrSum = 0, atrN = 0;
    for (let i = 1; i < buckets.length; i++) {
      atrSum += Math.abs((buckets[i] - buckets[i - 1]) / buckets[i - 1]) * 100;
      atrN++;
    }
    const atrPct = atrN > 0 ? atrSum / atrN : null;

    let regime: Regime = "mixed";
    if (straightness >= 0.55) regime = "trend";
    else if (straightness <= 0.30) regime = "chop";
    const reason = `straight ${(straightness * 100).toFixed(0)}% · ATR ${atrPct?.toFixed(3) ?? "?"}%/m → ${regime}`;
    return { ready: true, regime, straightness, atrPct, reason };
  }, [ticks]);
}
