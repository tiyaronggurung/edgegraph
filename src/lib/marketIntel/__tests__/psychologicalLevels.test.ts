import { describe, it, expect } from "vitest";
import { analyzePsychologicalLevels } from "../psychologicalLevels";
import type { Candle } from "../types";

function C(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1, closed: true };
}

/** Series that spends most bars near `base`, oscillating gently. */
function nearBase(n: number, base: number, jitter = 15): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = base + (i % 2 === 0 ? -jitter : jitter) * 0.5;
    const c = base + (i % 2 === 0 ? jitter : -jitter) * 0.5;
    out.push(C(i * 60_000, o, Math.max(o, c) + jitter * 0.4, Math.min(o, c) - jitter * 0.4, c));
  }
  return out;
}

describe("psychologicalLevels: fresh untested level scores weakly", () => {
  it("returns low strength when history never touches nearby round numbers", () => {
    // Trade purely between 100_120 and 100_180 — never touches 100_000 or 100_100 or 100_200.
    const cs: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const px = 100_150 + (i % 2 === 0 ? -20 : 20);
      cs.push(C(i * 60_000, px - 5, px + 8, px - 8, px + 5));
    }
    const result = analyzePsychologicalLevels(100_150, cs, cs, 20);
    // Nearest untested level should be present with low strength.
    expect(result.strength).toBeLessThan(45);
  });
});

describe("psychologicalLevels: repeated crossings → chop magnet", () => {
  it("many close crossings around a round number produce chop_magnet state", () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      // Zig above/below 100_000 with wide closes so crossings are unambiguous.
      const c = i % 2 === 0 ? 100_040 : 99_960;
      const o = i % 2 === 0 ? 99_960 : 100_040;
      cs.push(C(i * 60_000, o, Math.max(o, c) + 5, Math.min(o, c) - 5, c));
    }
    const result = analyzePsychologicalLevels(100_000, cs, cs, 30);
    expect(result.state).toBe("chop_magnet");
    expect(result.crossings).toBeGreaterThanOrEqual(4);
  });
});

describe("psychologicalLevels: level alone does not create direction", () => {
  it("output only contains role/state/strength — no direction field exists", () => {
    const cs = nearBase(30, 100_000, 40);
    const result = analyzePsychologicalLevels(100_000, cs, cs, 20);
    // Sanity: shape only carries role, no UP/DOWN "direction" claim
    expect(result).not.toHaveProperty("direction");
    expect(["support", "resistance", "none"]).toContain(result.role);
  });
});

describe("psychologicalLevels: $500 with confirmed rejections beats untested $50", () => {
  it("scores higher when it has real interaction history", () => {
    // Build a series that repeatedly rejects at 100_500 (from below).
    const cs: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      // Every 4th bar tags 100_500 with a wick and closes back below.
      if (i % 4 === 3) cs.push(C(i * 60_000, 100_400, 100_508, 100_390, 100_420));
      else cs.push(C(i * 60_000, 100_400, 100_450, 100_360, 100_420));
    }
    const withHistory = analyzePsychologicalLevels(100_450, cs, cs, 30);

    // Untested $50 level with no interaction near 100_050 spot
    const cs2: Candle[] = [];
    for (let i = 0; i < 50; i++) cs2.push(C(i * 60_000, 100_020, 100_030, 100_010, 100_025));
    const untested = analyzePsychologicalLevels(100_050, cs2, cs2, 10);

    expect(withHistory.strength).toBeGreaterThan(untested.strength);
  });
});
