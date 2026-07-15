// Pure volatility engine. ATR across 1m/5m/15m, realized vol, regime
// classification, expected 15-minute 1σ move + strike distance in expected moves.

import type { Candle, VolatilityRegime, VolatilityResult } from "./types";

/** Wilder-style ATR over closed candles. Returns null if insufficient. */
export function atr(candles: Candle[], period = 14): number | null {
  const closed = candles.filter(c => c.closed);
  if (closed.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < closed.length; i++) {
    const c = closed[i], p = closed[i - 1];
    const tr = Math.max(
      c.h - c.l,
      Math.abs(c.h - p.c),
      Math.abs(c.l - p.c),
    );
    trs.push(tr);
  }
  // Simple average of last `period` TRs (close enough to Wilder for our uses).
  const tail = trs.slice(-period);
  const sum = tail.reduce((a, b) => a + b, 0);
  return sum / tail.length;
}

/** Stddev of 1m log-returns, expressed as % per minute. Null if insufficient. */
export function realizedVolPctPerMin(candles1m: Candle[], lookback = 30): number | null {
  const closed = candles1m.filter(c => c.closed).slice(-lookback);
  if (closed.length < 8) return null;
  const rets: number[] = [];
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1].c, b = closed[i].c;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * 100; // % per minute
}

/** Classify vol regime by comparing recent 1m ATR to its rolling median. */
export function classifyRegime(candles1m: Candle[]): { regime: VolatilityRegime; reason: string } {
  const closed = candles1m.filter(c => c.closed);
  if (closed.length < 40) return { regime: "normal", reason: "short history" };
  const trs: number[] = [];
  for (let i = 1; i < closed.length; i++) {
    const c = closed[i], p = closed[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const recent = trs.slice(-10);
  const baseline = trs.slice(-40, -10);
  if (baseline.length < 10) return { regime: "normal", reason: "short baseline" };
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const rMed = median(recent);
  const bMed = median(baseline);
  if (bMed <= 0) return { regime: "normal", reason: "zero baseline" };
  const ratio = rMed / bMed;
  if (ratio >= 2.5) return { regime: "shock", reason: `atr×${ratio.toFixed(2)} vs base` };
  if (ratio >= 1.5) return { regime: "expanding", reason: `atr×${ratio.toFixed(2)}` };
  if (ratio <= 0.6)  return { regime: "compressed", reason: `atr×${ratio.toFixed(2)}` };
  return { regime: "normal", reason: `atr×${ratio.toFixed(2)}` };
}

/**
 * Expected 1σ price move over the next `minutes` in USD + %.
 * Uses realized vol/min if available; otherwise falls back to ATR-based estimate.
 * σ scales with sqrt(t).
 */
export function expectedMove(
  spot: number,
  candles1m: Candle[],
  minutes: number,
): { usd: number; pct: number; source: "realized" | "atr" | "fallback" } {
  const rv = realizedVolPctPerMin(candles1m, 30);
  if (rv != null && rv > 0) {
    const pct = rv * Math.sqrt(minutes);
    return { usd: (pct / 100) * spot, pct, source: "realized" };
  }
  const a = atr(candles1m, 14);
  if (a != null && spot > 0) {
    // ATR ≈ ~1 typical bar range; treat as ~1σ per minute in $.
    const usd = a * Math.sqrt(minutes);
    return { usd, pct: (usd / spot) * 100, source: "atr" };
  }
  // Fallback: 0.15%/min BTC baseline.
  const pct = 0.15 * Math.sqrt(minutes);
  return { usd: (pct / 100) * spot, pct, source: "fallback" };
}

export function computeVolatility(
  spot: number,
  strike: number,
  candles1m: Candle[],
  candles5m: Candle[],
  candles15m: Candle[],
): VolatilityResult {
  const atr1m = atr(candles1m, 14);
  const atr5m = atr(candles5m, 14);
  const atr15m = atr(candles15m, 14);
  const realizedVolPct = realizedVolPctPerMin(candles1m, 30);
  const { regime, reason } = classifyRegime(candles1m);
  const em = expectedMove(spot, candles1m, 15);

  const strikeDistanceUsd = Math.abs(spot - strike);
  const strikeDistanceInExpectedMoves = em.usd > 0 ? strikeDistanceUsd / em.usd : 0;

  const reasons: string[] = [
    `regime=${regime} (${reason})`,
    `E[15m]=$${em.usd.toFixed(0)} (${em.pct.toFixed(2)}%, ${em.source})`,
    `strike Δ=${strikeDistanceInExpectedMoves.toFixed(2)}σ`,
  ];

  return {
    atr1m, atr5m, atr15m,
    realizedVolPct,
    regime,
    expectedMove15mUsd: em.usd,
    expectedMove15mPct: em.pct,
    strikeDistanceUsd,
    strikeDistanceInExpectedMoves,
    reasons,
  };
}
