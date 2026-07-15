// Sequence analysis — reads the "shape" of the last N completed candles.
// Deliberately NOT using naive green/red counts. Analyzes efficiency, overlap,
// body/wick trends, ATR-normalized ranges, and prior structure context.
// Pure. Deterministic. Closed candles only.

import type {
  Candle,
  SequenceAnalysis,
  SequenceState,
  Direction,
  StructureResult,
} from "./types";

function body(c: Candle) { return Math.abs(c.c - c.o); }
function range(c: Candle) { return Math.max(1e-9, c.h - c.l); }
function upperWick(c: Candle) { return c.h - Math.max(c.o, c.c); }
function lowerWick(c: Candle) { return Math.min(c.o, c.c) - c.l; }
function isGreen(c: Candle) { return c.c > c.o; }
function isRed(c: Candle) { return c.c < c.o; }

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

/** Directional efficiency ∈ [0,1]: |net| / sum(|steps|) on closes. */
function efficiency(cs: Candle[]): number {
  if (cs.length < 2) return 0;
  let net = 0, gross = 0;
  for (let i = 1; i < cs.length; i++) {
    const d = cs[i].c - cs[i - 1].c;
    net += d; gross += Math.abs(d);
  }
  return gross > 0 ? Math.abs(net) / gross : 0;
}

/** Average pairwise overlap of consecutive candle ranges ∈ [0,1]. */
function overlap(cs: Candle[]): number {
  if (cs.length < 2) return 0;
  const os: number[] = [];
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    const lo = Math.max(a.l, b.l), hi = Math.min(a.h, b.h);
    const inter = Math.max(0, hi - lo);
    const union = Math.max(a.h, b.h) - Math.min(a.l, b.l);
    os.push(union > 0 ? inter / union : 0);
  }
  return mean(os);
}

/** Fraction of consecutive candles that alternate color. */
function alternation(cs: Candle[]): number {
  if (cs.length < 2) return 0;
  let flips = 0, pairs = 0;
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    if (a.c === a.o || b.c === b.o) continue;
    pairs++;
    if ((isGreen(a) && isRed(b)) || (isRed(a) && isGreen(b))) flips++;
  }
  return pairs > 0 ? flips / pairs : 0;
}

/** Linear trend of a series: slope sign returned as -1/0/+1 and magnitude as slope/mean. */
function trendSlope(xs: number[]): { sign: -1 | 0 | 1; magnitude: number } {
  const n = xs.length;
  if (n < 3) return { sign: 0, magnitude: 0 };
  const m = mean(xs);
  const xm = (n - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xm) * (xs[i] - m); den += (i - xm) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const rel = m !== 0 ? slope / Math.abs(m) : 0;
  const sign: -1 | 0 | 1 = Math.abs(rel) < 0.02 ? 0 : (rel > 0 ? 1 : -1);
  return { sign, magnitude: Math.abs(rel) };
}

export function analyzeSequence(
  candles1m: Candle[],
  candles5m: Candle[],
  candles15m: Candle[],
  structure: StructureResult,
): SequenceAnalysis {
  const c1 = candles1m.filter(c => c.closed).slice(-10);
  const c5 = candles5m.filter(c => c.closed).slice(-6);
  const c15 = candles15m.filter(c => c.closed).slice(-4);

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (c1.length < 5 && c5.length < 3) {
    return {
      state: "neutral",
      direction: "NEUTRAL",
      confidence: 0,
      continuationScore: 0, reversalScore: 0, exhaustionScore: 0,
      chopScore: 0, compressionScore: 0, expansionScore: 0,
      reasons: ["insufficient history"],
      warnings: [],
    };
  }

  // ---- Metrics on 1m (primary sequence signal) ----
  const eff1 = efficiency(c1);
  const ov1 = overlap(c1);
  const alt1 = alternation(c1);
  const bodies1 = c1.map(body);
  const ranges1 = c1.map(range);
  const upWicks1 = c1.map(upperWick);
  const loWicks1 = c1.map(lowerWick);
  const bodyTrend = trendSlope(bodies1);
  const rangeTrend = trendSlope(ranges1);
  const upWickTrend = trendSlope(upWicks1);
  const loWickTrend = trendSlope(loWicks1);
  const netMove1 = c1.length ? (c1[c1.length - 1].c - c1[0].c) : 0;
  const netDir: Direction = Math.abs(netMove1) < mean(ranges1) * 0.3 ? "NEUTRAL" : (netMove1 > 0 ? "UP" : "DOWN");

  // 5m corroboration
  const eff5 = efficiency(c5);
  const net5 = c5.length ? (c5[c5.length - 1].c - c5[0].c) : 0;
  const dir5: Direction = c5.length < 3 ? "NEUTRAL" : (Math.abs(net5) < mean(c5.map(range)) * 0.3 ? "NEUTRAL" : (net5 > 0 ? "UP" : "DOWN"));

  reasons.push(`1m eff=${eff1.toFixed(2)} ovlp=${ov1.toFixed(2)} alt=${alt1.toFixed(2)}`);
  reasons.push(`net1m=${netMove1.toFixed(1)} net5m=${net5.toFixed(1)}`);

  // ---- Score each state 0..100 ----
  let continuation = 0, reversal = 0, exhaustion = 0;
  let chop = 0, compression = 0, expansion = 0;

  // CHOP: high overlap + high alternation + low efficiency
  chop = Math.round(100 * Math.max(0, (ov1 * 0.5) + (alt1 * 0.4) + ((1 - eff1) * 0.1) - 0.35) / 0.65);
  chop = Math.max(0, Math.min(100, chop));

  // COMPRESSION: ranges shrinking
  if (rangeTrend.sign < 0) compression = Math.min(100, Math.round(rangeTrend.magnitude * 800));
  // EXPANSION: ranges growing
  if (rangeTrend.sign > 0) expansion = Math.min(100, Math.round(rangeTrend.magnitude * 800));

  // EXHAUSTION detection — 3+ candles same net direction, bodies SHRINKING, opposing wicks GROWING
  const last3 = c1.slice(-3);
  const l3Green = last3.filter(isGreen).length;
  const l3Red = last3.filter(isRed).length;
  const bodyShrinking = bodyTrend.sign < 0 && bodyTrend.magnitude > 0.05;
  if (l3Green >= 2 && bodyShrinking && upWickTrend.sign > 0 && netMove1 > 0) {
    exhaustion = 70;
    reasons.push("bullish exhaustion: shrinking bodies + growing upper wicks");
  }
  if (l3Red >= 2 && bodyShrinking && loWickTrend.sign > 0 && netMove1 < 0) {
    exhaustion = 70;
    reasons.push("bearish exhaustion: shrinking bodies + growing lower wicks");
  }

  // REVERSAL: strong opposite candle vs prior trend
  const lastC = c1[c1.length - 1];
  const priorTrend = structure.direction;
  if (priorTrend === "UP" && isRed(lastC) && body(lastC) > mean(bodies1.slice(0, -1)) * 1.6 && range(lastC) > mean(ranges1.slice(0, -1))) {
    reversal = 65; reasons.push("large bear candle vs uptrend");
  }
  if (priorTrend === "DOWN" && isGreen(lastC) && body(lastC) > mean(bodies1.slice(0, -1)) * 1.6 && range(lastC) > mean(ranges1.slice(0, -1))) {
    reversal = 65; reasons.push("large bull candle vs downtrend");
  }

  // CONTINUATION: high efficiency, aligned with prior trend, and (5m agrees or netDir matches)
  if (eff1 > 0.45 && netDir !== "NEUTRAL" && (dir5 === netDir || dir5 === "NEUTRAL")) {
    continuation = Math.min(100, Math.round(eff1 * 100 + (eff5 * 20)));
  }

  // ---- State selection (priority order) ----
  let state: SequenceState = "neutral";
  let direction: Direction = "NEUTRAL";

  const strong = (x: number, t: number) => x >= t;

  if (strong(chop, 55)) {
    state = "chop"; direction = "NEUTRAL"; warnings.push("chop dominates");
  } else if (strong(exhaustion, 60)) {
    state = netMove1 > 0 ? "bullish_exhaustion" : "bearish_exhaustion";
    direction = "NEUTRAL"; // exhaustion warns; does NOT auto-reverse
    warnings.push("exhaustion detected — do not auto-reverse");
  } else if (strong(reversal, 60)) {
    state = priorTrend === "UP" ? "bearish_reversal" : "bullish_reversal";
    direction = state === "bullish_reversal" ? "UP" : "DOWN";
  } else if (strong(continuation, 55) && netDir !== "NEUTRAL") {
    // pullback vs continuation vs full continuation depending on prior structure
    if (priorTrend !== "NEUTRAL" && priorTrend !== netDir) {
      // last leg moved against structure — that's a pullback within the larger trend
      state = priorTrend === "UP" ? "bullish_pullback" : "bearish_pullback";
      direction = priorTrend; // pullback still favors the prevailing trend
      reasons.push("counter-trend leg treated as pullback");
    } else {
      state = netDir === "UP" ? "bullish_continuation" : "bearish_continuation";
      direction = netDir;
    }
  } else if (strong(compression, 55)) {
    state = "compression"; direction = "NEUTRAL";
  } else if (strong(expansion, 55) && netDir !== "NEUTRAL") {
    state = "expansion"; direction = netDir;
  } else if (netDir !== "NEUTRAL" && priorTrend !== "NEUTRAL" && netDir !== priorTrend) {
    // small counter-trend move with weak evidence → pullback, not reversal
    state = priorTrend === "UP" ? "bullish_pullback" : "bearish_pullback";
    direction = priorTrend;
    reasons.push("weak counter-move within trend → pullback");
  } else if (netDir !== "NEUTRAL") {
    state = "transition"; direction = netDir;
  } else {
    state = "neutral"; direction = "NEUTRAL";
  }

  // ---- Confidence ----
  let confidence = 0;
  if (state === "chop" || state === "neutral") confidence = Math.max(chop, 20);
  else if (state.includes("continuation")) confidence = Math.min(90, continuation + (dir5 === direction ? 10 : 0));
  else if (state.includes("pullback")) confidence = 45;
  else if (state.includes("reversal")) confidence = Math.min(80, reversal);
  else if (state.includes("exhaustion")) confidence = exhaustion;
  else if (state === "compression") confidence = compression;
  else if (state === "expansion") confidence = expansion;
  else confidence = 30;

  // Downgrade if 1m disagrees with 5m and we picked a 1m direction
  if (direction !== "NEUTRAL" && dir5 !== "NEUTRAL" && dir5 !== direction) {
    warnings.push("1m/5m disagreement — confidence reduced");
    confidence = Math.max(15, Math.round(confidence * 0.5));
  }

  // 15m context if available
  if (c15.length >= 3) {
    const net15 = c15[c15.length - 1].c - c15[0].c;
    const dir15: Direction = Math.abs(net15) < mean(c15.map(range)) * 0.3 ? "NEUTRAL" : (net15 > 0 ? "UP" : "DOWN");
    if (dir15 !== "NEUTRAL" && direction !== "NEUTRAL" && dir15 !== direction) {
      warnings.push("15m disagreement");
      confidence = Math.max(10, Math.round(confidence * 0.6));
    } else if (dir15 === direction && direction !== "NEUTRAL") {
      confidence = Math.min(95, confidence + 5);
    }
  }

  return {
    state,
    direction,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    continuationScore: continuation,
    reversalScore: reversal,
    exhaustionScore: exhaustion,
    chopScore: chop,
    compressionScore: compression,
    expansionScore: expansion,
    reasons,
    warnings,
  };
}
