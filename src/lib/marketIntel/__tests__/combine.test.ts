import { describe, it, expect } from "vitest";
import { computeMarketIntel } from "../combine";
import { analyzeSequence } from "../sequence";
import { detectPatterns } from "../candlePatterns";
import { classifyStructure, classifyStructureSingle } from "../structure";
import { atr } from "../volatility";
import type { Candle } from "../types";

// ------------- Fixture helpers -------------

function C(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1, closed: true };
}

/** Zigzag ramp: overall directional but with small pullbacks so fractal swings exist. */
function ramp(
  n: number,
  start: number,
  step: number,
  opts: { bodyPct?: number; wick?: number; wickBias?: "up" | "down" | "even" } = {},
): Candle[] {
  const { bodyPct = 0.7, wickBias = "even" } = opts;
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const o = px;
    // Every 3rd bar: pull back ~45% of a step to create swing points.
    const s = i > 0 && i % 3 === 2 ? -step * 0.45 : step;
    const c = px + s;
    const b = Math.abs(c - o) || 1;
    const totalRange = b / bodyPct;
    const wickTotal = Math.max(0, totalRange - b);
    let up = wickTotal / 2, lo = wickTotal / 2;
    if (wickBias === "up") { up = wickTotal * 0.85; lo = wickTotal * 0.15; }
    if (wickBias === "down") { up = wickTotal * 0.15; lo = wickTotal * 0.85; }
    const h = Math.max(o, c) + up;
    const l = Math.min(o, c) - lo;
    out.push(C(i * 60_000, o, h, l, c));
    px = c;
  }
  return out;
}

/** Chop: alternating green/red with heavy overlap around a level. */
function chop(n: number, base = 100_000, amp = 40): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const o = base + (i % 2 === 0 ? -amp * 0.4 : amp * 0.4);
    const c = base + dir * amp * 0.4;
    const h = base + amp * 0.7;
    const l = base - amp * 0.7;
    out.push(C(i * 60_000, o, h, l, c));
  }
  return out;
}

// ------------- Sequence tests -------------

describe("sequence: exhaustion detection (turn-2 requirement)", () => {
  it("three green candles with shrinking bodies + growing upper wicks → bullish exhaustion", () => {
    const c1: Candle[] = [
      ...ramp(7, 100_000, 30, { bodyPct: 0.6 }),
      C(7 * 60_000, 100_210, 100_260, 100_205, 100_240),  // body 30, upper wick 20
      C(8 * 60_000, 100_240, 100_310, 100_235, 100_260),  // body 20, upper wick 50
      C(9 * 60_000, 100_260, 100_360, 100_255, 100_275),  // body 15, upper wick 85
    ];
    const c5 = ramp(6, 100_000, 100, { bodyPct: 0.7 });
    const c15 = ramp(4, 100_000, 200, { bodyPct: 0.7 });
    const struct = classifyStructure(c1, c5, c15);
    const seq = analyzeSequence(c1, c5, c15, struct);
    expect(seq.state).toBe("bullish_exhaustion");
    expect(seq.direction).toBe("NEUTRAL"); // does NOT auto-flip to DOWN
    expect(seq.exhaustionScore).toBeGreaterThanOrEqual(60);
  });

  it("three red candles with shrinking bodies + growing lower wicks → bearish exhaustion", () => {
    const c1: Candle[] = [
      ...ramp(7, 100_000, -30, { bodyPct: 0.6 }),
      C(7 * 60_000, 99_790, 99_795, 99_740, 99_760),  // body 30, lower 20
      C(8 * 60_000, 99_760, 99_765, 99_690, 99_740),  // body 20, lower 50
      C(9 * 60_000, 99_740, 99_745, 99_640, 99_725),  // body 15, lower 85
    ];
    const c5 = ramp(6, 100_000, -100, { bodyPct: 0.7 });
    const c15 = ramp(4, 100_000, -200, { bodyPct: 0.7 });
    const struct = classifyStructure(c1, c5, c15);
    const seq = analyzeSequence(c1, c5, c15, struct);
    expect(seq.state).toBe("bearish_exhaustion");
    expect(seq.direction).toBe("NEUTRAL");
  });
});

describe("sequence: chop", () => {
  it("alternating overlapping candles → chop + NEUTRAL", () => {
    const c1 = chop(12, 100_000, 40);
    const c5 = chop(6, 100_000, 40);
    const c15 = chop(4, 100_000, 40);
    const struct = classifyStructure(c1, c5, c15);
    const seq = analyzeSequence(c1, c5, c15, struct);
    expect(seq.state).toBe("chop");
    expect(seq.direction).toBe("NEUTRAL");
    expect(seq.chopScore).toBeGreaterThan(40);
  });
});

describe("sequence: single red candle inside a bullish pullback does not force DOWN", () => {
  it("bullish structure + one red bar → pullback, direction still UP", () => {
    const c1: Candle[] = [
      ...ramp(9, 100_000, 40, { bodyPct: 0.65 }),
      // one clearly red pullback candle
      C(9 * 60_000, 100_360, 100_365, 100_320, 100_330),
    ];
    const c5 = ramp(6, 100_000, 150, { bodyPct: 0.7 });
    const c15 = ramp(4, 100_000, 300, { bodyPct: 0.7 });
    const struct = classifyStructure(c1, c5, c15);
    const seq = analyzeSequence(c1, c5, c15, struct);
    expect(seq.direction).not.toBe("DOWN");
  });
});

describe("sequence: 1m noise cannot override 5m/15m structure", () => {
  it("bearish 5m/15m + choppy-slightly-up 1m → not UP", () => {
    const c1 = chop(10, 100_000, 30); // near-neutral
    const c5 = ramp(6, 100_000, -200, { bodyPct: 0.75 });
    const c15 = ramp(4, 100_000, -500, { bodyPct: 0.75 });
    const intel = computeMarketIntel({
      spot: 99_500, strike: 99_500,
      candles1m: c1, candles5m: c5, candles15m: c15,
    });
    expect(intel.structure_direction).toBe("DOWN");
    expect(intel.direction).not.toBe("UP");
  });
});

// ------------- Pattern tests -------------

describe("candlePatterns: context matters, not the name", () => {
  it("bullish engulfing in chop scores weakly (contextScore low)", () => {
    const noise = chop(20, 100_000, 30);
    // Force last two candles to be an engulfing pattern in the middle of noise
    const closed = [...noise];
    closed[closed.length - 2] = C(closed.length - 2, 100_010, 100_015, 99_985, 99_990); // red
    closed[closed.length - 1] = C(closed.length - 1, 99_985, 100_030, 99_980, 100_025); // bull engulfing
    const struct = classifyStructureSingle(closed);
    const patterns = detectPatterns(closed, "1m", struct, atr(closed, 14), "NEUTRAL");
    const eng = patterns.find(p => p.name === "bullish_engulfing");
    expect(eng).toBeTruthy();
    expect(eng!.contextScore).toBeLessThan(55);
  });

  it("bullish engulfing after bearish move at support scores strongly", () => {
    // downtrend into a support level, then engulfing
    const down = ramp(10, 100_000, -80, { bodyPct: 0.7 });
    const last = down[down.length - 1];
    const engulf1 = C(down.length, last.c, last.c + 5, last.c - 40, last.c - 30);       // small red
    const engulf2 = C(down.length + 1, last.c - 30, last.c + 40, last.c - 35, last.c + 35); // big bull engulf
    const conf = C(down.length + 2, last.c + 35, last.c + 100, last.c + 30, last.c + 90); // confirmation
    const closed = [...down, engulf1, engulf2, conf];
    const struct = classifyStructureSingle(closed);
    const patterns = detectPatterns(closed, "1m", struct, atr(closed, 14), "DOWN");
    const eng = patterns.find(p => p.name === "bullish_engulfing");
    expect(eng).toBeTruthy();
    expect(eng!.contextScore).toBeGreaterThan(50);
    expect(eng!.confirmed).toBe(true);
  });
});

// ------------- Combine tests -------------

describe("combine: structure + sequence agreement", () => {
  it("clean uptrend on all TFs → UP with higher confidence than a chop input", () => {
    const trendIntel = computeMarketIntel({
      spot: 101_500, strike: 101_500,
      candles1m: ramp(20, 100_000, 80, { bodyPct: 0.7 }),
      candles5m: ramp(10, 100_000, 300, { bodyPct: 0.7 }),
      candles15m: ramp(6, 100_000, 600, { bodyPct: 0.7 }),
    });
    const chopIntel = computeMarketIntel({
      spot: 100_000, strike: 100_000,
      candles1m: chop(20, 100_000, 40),
      candles5m: chop(10, 100_000, 40),
      candles15m: chop(6, 100_000, 40),
    });
    expect(trendIntel.direction).toBe("UP");
    expect(trendIntel.confidence).toBeGreaterThan(chopIntel.confidence);
  });

  it("high chop → NEUTRAL with low confidence", () => {
    const intel = computeMarketIntel({
      spot: 100_000, strike: 100_000,
      candles1m: chop(20, 100_000, 40),
      candles5m: chop(10, 100_000, 40),
      candles15m: chop(6, 100_000, 40),
    });
    expect(intel.direction).toBe("NEUTRAL");
    expect(intel.confidence).toBeLessThan(35);
  });

  it("strike far beyond expected 15m move → confidence damped", () => {
    const base = {
      candles1m: ramp(20, 100_000, 20, { bodyPct: 0.6 }),
      candles5m: ramp(10, 100_000, 60, { bodyPct: 0.6 }),
      candles15m: ramp(6, 100_000, 120, { bodyPct: 0.6 }),
    };
    const near = computeMarketIntel({ ...base, spot: 100_400, strike: 100_500 });
    const far = computeMarketIntel({ ...base, spot: 100_400, strike: 110_000 });
    expect(far.confidence).toBeLessThan(near.confidence);
  });

  it("deterministic: same input → same output", () => {
    const input = {
      spot: 100_500, strike: 100_500,
      candles1m: ramp(20, 100_000, 50, { bodyPct: 0.65 }),
      candles5m: ramp(10, 100_000, 200, { bodyPct: 0.7 }),
      candles15m: ramp(6, 100_000, 400, { bodyPct: 0.7 }),
    };
    const a = computeMarketIntel(input);
    const b = computeMarketIntel(input);
    expect(a).toEqual(b);
  });

  it("only completed candles are used (unclosed candles ignored)", () => {
    const c1 = ramp(20, 100_000, 40, { bodyPct: 0.65 });
    const withForming = [...c1, { ...c1[c1.length - 1], t: 20 * 60_000, c: 90_000, o: 100_800, closed: false }];
    const clean = computeMarketIntel({
      spot: 100_800, strike: 100_800,
      candles1m: c1,
      candles5m: ramp(10, 100_000, 200, { bodyPct: 0.7 }),
      candles15m: ramp(6, 100_000, 400, { bodyPct: 0.7 }),
    });
    const contaminated = computeMarketIntel({
      spot: 100_800, strike: 100_800,
      candles1m: withForming,
      candles5m: ramp(10, 100_000, 200, { bodyPct: 0.7 }),
      candles15m: ramp(6, 100_000, 400, { bodyPct: 0.7 }),
    });
    expect(contaminated.direction).toBe(clean.direction);
    expect(contaminated.confidence).toBe(clean.confidence);
  });

  it("final candle color does not decide direction (bear-red-in-uptrend stays UP)", () => {
    const c1: Candle[] = [
      ...ramp(15, 100_000, 40, { bodyPct: 0.65 }),
      C(15 * 60_000, 100_600, 100_610, 100_555, 100_570), // one red pullback
    ];
    const intel = computeMarketIntel({
      spot: 100_570, strike: 100_570,
      candles1m: c1,
      candles5m: ramp(10, 100_000, 200, { bodyPct: 0.7 }),
      candles15m: ramp(6, 100_000, 400, { bodyPct: 0.7 }),
    });
    expect(intel.direction).not.toBe("DOWN");
  });

  it("conflicting structure vs weak reversal → neutral/low confidence", () => {
    const c1: Candle[] = [
      ...ramp(15, 100_000, 60, { bodyPct: 0.65 }),
      // one small red — not a strong reversal
      C(15 * 60_000, 100_900, 100_910, 100_880, 100_890),
    ];
    const intel = computeMarketIntel({
      spot: 100_890, strike: 100_890,
      candles1m: c1,
      candles5m: ramp(10, 100_000, 250, { bodyPct: 0.7 }),
      candles15m: ramp(6, 100_000, 500, { bodyPct: 0.7 }),
    });
    // Should stay UP or NEUTRAL, never DOWN with high confidence
    expect(intel.direction === "UP" || intel.direction === "NEUTRAL").toBe(true);
    if (intel.direction === "NEUTRAL") expect(intel.confidence).toBeLessThan(40);
  });
});
