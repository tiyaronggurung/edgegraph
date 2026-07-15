// Pure market-structure detection over completed candles.
// Fractal swing pivots (N=2) → HH/HL/LH/LL classifier → market_state + strength.
// NO forming-candle input. NO Date.now(). NO I/O.

import type { Candle, StructurePoint, StructureResult, Direction, MarketState } from "./types";

const PIVOT_N = 2; // 5-bar fractal: needs 2 neighbors each side

/** Extract fractal swing highs/lows from closed candles, oldest→newest. */
export function findSwings(candles: Candle[]): StructurePoint[] {
  const closed = candles.filter(c => c.closed);
  if (closed.length < PIVOT_N * 2 + 1) return [];
  const out: StructurePoint[] = [];
  for (let i = PIVOT_N; i < closed.length - PIVOT_N; i++) {
    const c = closed[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= PIVOT_N; j++) {
      if (closed[i - j].h >= c.h || closed[i + j].h >= c.h) isHigh = false;
      if (closed[i - j].l <= c.l || closed[i + j].l <= c.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ t: c.t, price: c.h, kind: "SH" });
    if (isLow)  out.push({ t: c.t, price: c.l, kind: "SL" });
  }
  return out;
}

interface Flags { hh: boolean; hl: boolean; lh: boolean; ll: boolean }

function compareLastPair(points: StructurePoint[], kind: "SH" | "SL"): "higher" | "lower" | "equal" | null {
  const filtered = points.filter(p => p.kind === kind);
  if (filtered.length < 2) return null;
  const [prev, last] = filtered.slice(-2);
  if (last.price > prev.price * 1.0002) return "higher";
  if (last.price < prev.price * 0.9998) return "lower";
  return "equal";
}

/**
 * Classify structure from swing points on a single timeframe.
 * Returns direction + a 0..100 strength.
 */
export function classifyStructureSingle(candles: Candle[]): StructureResult {
  const swings = findSwings(candles);
  const closed = candles.filter(c => c.closed);
  const empty: StructureResult = {
    state: "range",
    direction: "NEUTRAL",
    strength: 0,
    swings,
    hh: false, hl: false, lh: false, ll: false,
    reasons: ["insufficient swings"],
  };
  if (swings.filter(s => s.kind === "SH").length < 2 || swings.filter(s => s.kind === "SL").length < 2) {
    return empty;
  }

  const shCmp = compareLastPair(swings, "SH");
  const slCmp = compareLastPair(swings, "SL");
  const flags: Flags = {
    hh: shCmp === "higher",
    hl: slCmp === "higher",
    lh: shCmp === "lower",
    ll: slCmp === "lower",
  };
  const reasons: string[] = [];
  if (flags.hh) reasons.push("HH");
  if (flags.hl) reasons.push("HL");
  if (flags.lh) reasons.push("LH");
  if (flags.ll) reasons.push("LL");

  let direction: Direction = "NEUTRAL";
  let state: MarketState = "range";
  let strength = 0;

  const bullVotes = (flags.hh ? 1 : 0) + (flags.hl ? 1 : 0);
  const bearVotes = (flags.lh ? 1 : 0) + (flags.ll ? 1 : 0);

  if (bullVotes === 2 && bearVotes === 0) {
    direction = "UP"; state = "bull_trend"; strength = 80;
  } else if (bearVotes === 2 && bullVotes === 0) {
    direction = "DOWN"; state = "bear_trend"; strength = 80;
  } else if (bullVotes === 1 && bearVotes === 0) {
    direction = "UP"; state = "transition"; strength = 50;
  } else if (bearVotes === 1 && bullVotes === 0) {
    direction = "DOWN"; state = "transition"; strength = 50;
  } else if (bullVotes === 1 && bearVotes === 1) {
    direction = "NEUTRAL"; state = "transition"; strength = 30;
    reasons.push("mixed structure");
  } else {
    direction = "NEUTRAL"; state = "range"; strength = 15;
  }

  // Nudge strength by trend cleanliness: how much of the recent range the last
  // 10 closes have covered in one direction. |net| / sum(|steps|) ∈ [0,1].
  const tail = closed.slice(-10).map(c => c.c);
  if (tail.length >= 3) {
    let net = 0, gross = 0;
    for (let i = 1; i < tail.length; i++) {
      const d = tail[i] - tail[i - 1];
      net += d;
      gross += Math.abs(d);
    }
    const clean = gross > 0 ? Math.abs(net) / gross : 0;
    strength = Math.max(0, Math.min(100, Math.round(strength * (0.5 + 0.7 * clean))));
    if (clean < 0.2 && direction !== "NEUTRAL") reasons.push("chop-diluted");
  }

  return { state, direction, strength, swings, ...flags, reasons };
}

/**
 * Multi-timeframe structure: combine 1m + 5m + optional 15m.
 * Higher timeframes weigh more. Never let the final candle alone decide.
 */
export function classifyStructure(
  candles1m: Candle[],
  candles5m: Candle[],
  candles15m: Candle[],
): StructureResult {
  const s1 = classifyStructureSingle(candles1m);
  const s5 = classifyStructureSingle(candles5m);
  const has15 = candles15m.filter(c => c.closed).length >= (PIVOT_N * 2 + 3);
  const s15 = has15 ? classifyStructureSingle(candles15m) : null;

  const dirScore = (d: Direction) => d === "UP" ? 1 : d === "DOWN" ? -1 : 0;
  // Weights: 15m 0.5, 5m 0.35, 1m 0.15
  const w15 = s15 ? 0.5 : 0;
  const w5 = s15 ? 0.35 : 0.7;
  const w1 = s15 ? 0.15 : 0.3;
  const votes =
    dirScore(s1.direction) * s1.strength * w1 +
    dirScore(s5.direction) * s5.strength * w5 +
    (s15 ? dirScore(s15.direction) * s15.strength * w15 : 0);

  const denom = 100 * (w1 + w5 + w15);
  const raw = denom > 0 ? votes / denom : 0; // -1..1

  let direction: Direction = "NEUTRAL";
  let state: MarketState = "range";
  if (raw > 0.35) { direction = "UP"; state = s5.state === "bull_trend" || (s15?.state === "bull_trend") ? "bull_trend" : "transition"; }
  else if (raw < -0.35) { direction = "DOWN"; state = s5.state === "bear_trend" || (s15?.state === "bear_trend") ? "bear_trend" : "transition"; }
  else if (Math.abs(raw) < 0.1) { direction = "NEUTRAL"; state = "range"; }
  else { direction = raw > 0 ? "UP" : "DOWN"; state = "transition"; }

  const strength = Math.round(Math.min(100, Math.abs(raw) * 100));

  const reasons: string[] = [];
  reasons.push(`1m:${s1.direction}(${s1.strength})`);
  reasons.push(`5m:${s5.direction}(${s5.strength})`);
  if (s15) reasons.push(`15m:${s15.direction}(${s15.strength})`);
  if (s1.direction !== "NEUTRAL" && s5.direction !== "NEUTRAL" && s1.direction !== s5.direction) {
    reasons.push("1m-vs-5m conflict");
  }

  // Use the 5m swings as the canonical returned swing list.
  return {
    state,
    direction,
    strength,
    swings: s5.swings,
    hh: s5.hh, hl: s5.hl, lh: s5.lh, ll: s5.ll,
    reasons,
  };
}
