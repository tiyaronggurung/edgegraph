import { describe, it, expect } from "vitest";
import { atr, realizedVolPctPerMin, classifyRegime, expectedMove, computeVolatility } from "../volatility";
import type { Candle } from "../types";

function mkCandles(n: number, base = 100_000, range = 100, drift = 0): Candle[] {
  const out: Candle[] = [];
  let px = base;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = px + drift + (i % 2 === 0 ? range * 0.2 : -range * 0.2);
    const h = Math.max(o, c) + range * 0.4;
    const l = Math.min(o, c) - range * 0.4;
    out.push({ t: i * 60_000, o, h, l, c, v: 1, closed: true });
    px = c;
  }
  return out;
}

describe("atr", () => {
  it("returns null when not enough candles", () => {
    expect(atr(mkCandles(5), 14)).toBeNull();
  });
  it("returns a positive value on normal data", () => {
    const a = atr(mkCandles(30, 100_000, 100), 14);
    expect(a).not.toBeNull();
    expect(a!).toBeGreaterThan(0);
  });
});

describe("realizedVolPctPerMin", () => {
  it("is positive on non-flat series", () => {
    const rv = realizedVolPctPerMin(mkCandles(30, 100_000, 200));
    expect(rv!).toBeGreaterThan(0);
  });
});

describe("classifyRegime", () => {
  it("returns normal on short history", () => {
    expect(classifyRegime(mkCandles(10)).regime).toBe("normal");
  });
  it("flags expansion when recent bars are much larger", () => {
    const calm = mkCandles(30, 100_000, 50);
    const wild = mkCandles(10, 100_000, 500).map((c, i) => ({ ...c, t: (30 + i) * 60_000 }));
    const combined = [...calm, ...wild];
    const r = classifyRegime(combined);
    expect(["expanding", "shock"]).toContain(r.regime);
  });
});

describe("expectedMove", () => {
  it("scales roughly with sqrt(minutes)", () => {
    const candles = mkCandles(30, 100_000, 200);
    const a = expectedMove(100_000, candles, 15).usd;
    const b = expectedMove(100_000, candles, 60).usd;
    // 60min vs 15min → sqrt(4) ≈ 2×
    expect(b / a).toBeGreaterThan(1.5);
    expect(b / a).toBeLessThan(2.5);
  });
});

describe("computeVolatility", () => {
  it("produces a full result including strike distance in expected moves", () => {
    const c = mkCandles(30, 100_000, 200);
    const r = computeVolatility(100_000, 100_500, c, c, c);
    expect(r.expectedMove15mUsd).toBeGreaterThan(0);
    expect(r.strikeDistanceUsd).toBeCloseTo(500, 0);
    expect(r.strikeDistanceInExpectedMoves).toBeGreaterThan(0);
  });
});
