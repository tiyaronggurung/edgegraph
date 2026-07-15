// Named candlestick pattern detection. Pure, deterministic, closed-candles only.
// Named patterns are shape-only; final bias comes from context scoring
// (structure, ATR normalization, S/R proximity, next-candle confirmation,
// multi-timeframe agreement). NEVER decides direction from pattern name alone.

import type {
  Candle,
  PatternDetection,
  Timeframe,
  StructureResult,
  Direction,
} from "./types";

// ------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------

function body(c: Candle) { return Math.abs(c.c - c.o); }
function range(c: Candle) { return Math.max(1e-9, c.h - c.l); }
function upperWick(c: Candle) { return c.h - Math.max(c.o, c.c); }
function lowerWick(c: Candle) { return Math.min(c.o, c.c) - c.l; }
function isGreen(c: Candle) { return c.c > c.o; }
function isRed(c: Candle) { return c.c < c.o; }
function bodyPct(c: Candle) { return body(c) / range(c); }
function closePos(c: Candle) { return (c.c - c.l) / range(c); } // 0..1

function meanRange(cs: Candle[]): number {
  if (cs.length === 0) return 0;
  return cs.reduce((a, c) => a + range(c), 0) / cs.length;
}

// ------------------------------------------------------------
// Shape detectors — each returns raw bias/strength or null
// ------------------------------------------------------------

interface Shape {
  name: string;
  bias: Direction;
  strength: number;         // 0..100
  candleIdx: number;        // index within `closed` array
  reasons: string[];
}

function detectSingle(c: Candle, prev: Candle | null, idx: number): Shape[] {
  const out: Shape[] = [];
  const bp = bodyPct(c);
  const up = upperWick(c) / range(c);
  const lo = lowerWick(c) / range(c);
  const cp = closePos(c);

  // Doji
  if (bp < 0.1) {
    out.push({ name: "doji", bias: "NEUTRAL", strength: 60, candleIdx: idx, reasons: ["body<10% range"] });
  }
  // Spinning top
  else if (bp < 0.35 && up > 0.25 && lo > 0.25) {
    out.push({ name: "spinning_top", bias: "NEUTRAL", strength: 45, candleIdx: idx, reasons: ["small body, both wicks"] });
  }

  // Marubozu
  if (bp > 0.9) {
    out.push({
      name: isGreen(c) ? "bullish_marubozu" : "bearish_marubozu",
      bias: isGreen(c) ? "UP" : "DOWN",
      strength: 75,
      candleIdx: idx,
      reasons: ["body>90% range"],
    });
  }

  // Hammer / shooting star (body ≤ 30%, one dominant wick)
  if (bp <= 0.35 && lo > 0.55 && up < 0.15) {
    out.push({ name: "hammer", bias: "UP", strength: 65, candleIdx: idx, reasons: [`lower wick ${(lo*100)|0}%`] });
  }
  if (bp <= 0.35 && up > 0.55 && lo < 0.15) {
    out.push({ name: "shooting_star", bias: "DOWN", strength: 65, candleIdx: idx, reasons: [`upper wick ${(up*100)|0}%`] });
  }

  // Rejection candle (long wick, close pushed back into range)
  if (lo > 0.5 && cp > 0.55 && bp < 0.5) {
    out.push({ name: "bullish_rejection", bias: "UP", strength: 55, candleIdx: idx, reasons: ["lower rejection wick"] });
  }
  if (up > 0.5 && cp < 0.45 && bp < 0.5) {
    out.push({ name: "bearish_rejection", bias: "DOWN", strength: 55, candleIdx: idx, reasons: ["upper rejection wick"] });
  }

  if (!prev) return out;

  // Engulfing (2-candle)
  const b = body(c), bPrev = body(prev);
  if (isGreen(c) && isRed(prev) && c.c >= prev.o && c.o <= prev.c && b > bPrev) {
    out.push({ name: "bullish_engulfing", bias: "UP", strength: 70, candleIdx: idx, reasons: ["engulfs prior red body"] });
  }
  if (isRed(c) && isGreen(prev) && c.c <= prev.o && c.o >= prev.c && b > bPrev) {
    out.push({ name: "bearish_engulfing", bias: "DOWN", strength: 70, candleIdx: idx, reasons: ["engulfs prior green body"] });
  }

  // Piercing / dark cloud (not full engulf, but close past midpoint)
  const prevMid = (prev.o + prev.c) / 2;
  if (isGreen(c) && isRed(prev) && c.o < prev.l && c.c > prevMid && c.c < prev.o) {
    out.push({ name: "piercing_line", bias: "UP", strength: 55, candleIdx: idx, reasons: ["closes past prior midpoint"] });
  }
  if (isRed(c) && isGreen(prev) && c.o > prev.h && c.c < prevMid && c.c > prev.o) {
    out.push({ name: "dark_cloud_cover", bias: "DOWN", strength: 55, candleIdx: idx, reasons: ["closes past prior midpoint"] });
  }

  // Tweezer top / bottom (matching extremes on 2 bars)
  const tol = 0.0005;
  if (Math.abs(c.h - prev.h) / prev.h < tol && isGreen(prev) && isRed(c)) {
    out.push({ name: "tweezer_top", bias: "DOWN", strength: 50, candleIdx: idx, reasons: ["matching highs"] });
  }
  if (Math.abs(c.l - prev.l) / prev.l < tol && isRed(prev) && isGreen(c)) {
    out.push({ name: "tweezer_bottom", bias: "UP", strength: 50, candleIdx: idx, reasons: ["matching lows"] });
  }

  // Inside / outside bar
  if (c.h < prev.h && c.l > prev.l) {
    out.push({ name: "inside_bar", bias: "NEUTRAL", strength: 40, candleIdx: idx, reasons: ["range contained"] });
  }
  if (c.h > prev.h && c.l < prev.l) {
    out.push({
      name: "outside_bar",
      bias: isGreen(c) ? "UP" : isRed(c) ? "DOWN" : "NEUTRAL",
      strength: 55,
      candleIdx: idx,
      reasons: ["engulfs prior range"],
    });
  }

  return out;
}

function detectTriple(cs: Candle[], idx: number): Shape[] {
  const [a, b, c] = cs;
  const out: Shape[] = [];
  const smallMid = bodyPct(b) < 0.35;

  // Morning star
  if (isRed(a) && smallMid && isGreen(c) && c.c > (a.o + a.c) / 2) {
    out.push({ name: "morning_star", bias: "UP", strength: 70, candleIdx: idx, reasons: ["red / doji-body / green"] });
  }
  // Evening star
  if (isGreen(a) && smallMid && isRed(c) && c.c < (a.o + a.c) / 2) {
    out.push({ name: "evening_star", bias: "DOWN", strength: 70, candleIdx: idx, reasons: ["green / doji-body / red"] });
  }

  return out;
}

/** Detect breakout/breakdown & failed variants vs prior N-bar high/low. */
function detectBreakout(closed: Candle[], idx: number, lookback = 10): Shape[] {
  if (idx < lookback + 1) return [];
  const c = closed[idx];
  const window = closed.slice(idx - lookback, idx);
  const hi = Math.max(...window.map(x => x.h));
  const lo = Math.min(...window.map(x => x.l));
  const out: Shape[] = [];

  if (c.c > hi && isGreen(c)) {
    out.push({ name: "breakout", bias: "UP", strength: 70, candleIdx: idx, reasons: [`closes above ${lookback}-bar high`] });
  }
  if (c.h > hi && c.c < hi) {
    out.push({ name: "failed_breakout", bias: "DOWN", strength: 60, candleIdx: idx, reasons: ["wick above range, close back inside"] });
  }
  if (c.c < lo && isRed(c)) {
    out.push({ name: "breakdown", bias: "DOWN", strength: 70, candleIdx: idx, reasons: [`closes below ${lookback}-bar low`] });
  }
  if (c.l < lo && c.c > lo) {
    out.push({ name: "failed_breakdown", bias: "UP", strength: 60, candleIdx: idx, reasons: ["wick below range, close back inside"] });
  }

  return out;
}

// ------------------------------------------------------------
// Context scoring
// ------------------------------------------------------------

function nearSwing(price: number, structure: StructureResult, tolUsd: number): "support" | "resistance" | null {
  const sls = structure.swings.filter(s => s.kind === "SL");
  const shs = structure.swings.filter(s => s.kind === "SH");
  if (sls.some(s => Math.abs(price - s.price) <= tolUsd)) return "support";
  if (shs.some(s => Math.abs(price - s.price) <= tolUsd)) return "resistance";
  return null;
}

function scoreContext(
  shape: Shape,
  closed: Candle[],
  structure: StructureResult,
  atrTf: number | null,
  otherTfStructureDir: Direction | null,
): { contextScore: number; confirmed: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [...shape.reasons];
  const warnings: string[] = [];
  let score = shape.strength * 0.5; // start at half; context adds/removes

  const c = closed[shape.candleIdx];
  const atrRef = atrTf ?? meanRange(closed.slice(-14));

  // ATR-normalized candle size — tiny patterns are noise.
  if (atrRef > 0) {
    const rel = range(c) / atrRef;
    if (rel < 0.5) { score -= 15; warnings.push("candle small vs ATR"); }
    else if (rel > 1.4) { score += 10; reasons.push("candle large vs ATR"); }
  }

  // S/R proximity
  const tol = Math.max(atrRef * 0.5, c.c * 0.0005);
  const sr = nearSwing(shape.bias === "UP" ? c.l : c.h, structure, tol);
  if (shape.bias === "UP" && sr === "support") { score += 20; reasons.push("at support"); }
  else if (shape.bias === "DOWN" && sr === "resistance") { score += 20; reasons.push("at resistance"); }
  else if (shape.bias !== "NEUTRAL" && sr === null) { score -= 5; }

  // Prior structure agreement
  if (shape.bias !== "NEUTRAL") {
    if (structure.direction === shape.bias) { score += 15; reasons.push("with structure"); }
    else if (structure.direction !== "NEUTRAL") {
      // Counter-structure only helps if there's a reversal setup (near S/R + strong shape)
      if (sr && shape.strength >= 65) { score += 5; reasons.push("counter-structure at S/R"); }
      else { score -= 20; warnings.push("against structure"); }
    }
  }

  // Confirmation from next completed candle (if any)
  let confirmed = false;
  const next = closed[shape.candleIdx + 1];
  if (next) {
    const confirms =
      (shape.bias === "UP" && isGreen(next) && next.c > c.c) ||
      (shape.bias === "DOWN" && isRed(next) && next.c < c.c);
    if (confirms) { confirmed = true; score += 15; reasons.push("next candle confirms"); }
    else if (shape.bias !== "NEUTRAL") { score -= 5; warnings.push("next candle did not confirm"); }
  } else {
    warnings.push("no confirmation yet");
  }

  // Higher-timeframe agreement (structure of the other TF passed in)
  if (otherTfStructureDir && shape.bias !== "NEUTRAL") {
    if (otherTfStructureDir === shape.bias) { score += 8; reasons.push("HTF agrees"); }
    else if (otherTfStructureDir !== "NEUTRAL") { score -= 10; warnings.push("HTF disagrees"); }
  }

  return {
    contextScore: Math.max(0, Math.min(100, Math.round(score))),
    confirmed,
    reasons,
    warnings,
  };
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export function detectPatterns(
  candles: Candle[],
  timeframe: Timeframe,
  structure: StructureResult,
  atrTf: number | null,
  htfStructureDir: Direction | null = null,
): PatternDetection[] {
  const closed = candles.filter(c => c.closed);
  if (closed.length < 3) return [];

  // Only look at the last few closed bars — patterns older than that don't matter.
  const scanFrom = Math.max(2, closed.length - 5);
  const shapes: Shape[] = [];

  for (let i = scanFrom; i < closed.length; i++) {
    const c = closed[i];
    const prev = closed[i - 1] ?? null;
    shapes.push(...detectSingle(c, prev, i));
    if (i >= 2) {
      shapes.push(...detectTriple([closed[i - 2], closed[i - 1], c], i));
    }
    shapes.push(...detectBreakout(closed, i, 10));
  }

  const out: PatternDetection[] = shapes.map(sh => {
    const ctx = scoreContext(sh, closed, structure, atrTf, htfStructureDir);
    return {
      name: sh.name,
      timeframe,
      bias: sh.bias,
      strength: sh.strength,
      confirmed: ctx.confirmed,
      contextScore: ctx.contextScore,
      reasons: ctx.reasons,
      warnings: ctx.warnings,
    };
  });

  // Deduplicate: keep highest contextScore per (name, timeframe, candleIdx implicit via order)
  const seen = new Map<string, PatternDetection>();
  for (const p of out) {
    const k = `${p.timeframe}:${p.name}`;
    const cur = seen.get(k);
    if (!cur || p.contextScore > cur.contextScore) seen.set(k, p);
  }
  return [...seen.values()].sort((a, b) => b.contextScore - a.contextScore);
}
