import { describe, it, expect } from "vitest";
import { findSwings, classifyStructureSingle, classifyStructure } from "../structure";
import type { Candle } from "../types";

function candle(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1, closed: true };
}

// Build a series of closed candles with configurable close prices;
// h/l are set as close ± 5 so that swing detection tracks close direction.
function series(closes: number[]): Candle[] {
  return closes.map((c, i) => candle(i * 60_000, i === 0 ? c : closes[i - 1], c + 5, c - 5, c));
}

describe("findSwings", () => {
  it("returns empty on short history", () => {
    expect(findSwings(series([1, 2, 3]))).toEqual([]);
  });

  it("detects a swing high and swing low with N=2 fractal", () => {
    // index 4 is a clear high (100), index 8 a clear low (80)
    const closes = [90, 92, 95, 98, 100, 96, 92, 85, 80, 84, 88];
    const swings = findSwings(series(closes));
    // Must contain at least one SH and one SL
    expect(swings.some(s => s.kind === "SH")).toBe(true);
    expect(swings.some(s => s.kind === "SL")).toBe(true);
  });
});

describe("classifyStructureSingle", () => {
  it("classifies clean uptrend as UP with high strength", () => {
    // Zigzag up: makes HH and HL
    const closes = [100, 105, 102, 110, 107, 115, 112, 120, 117, 125, 122, 130];
    const r = classifyStructureSingle(series(closes));
    expect(r.direction).toBe("UP");
    expect(r.strength).toBeGreaterThan(30);
  });

  it("classifies clean downtrend as DOWN", () => {
    const closes = [130, 125, 128, 120, 123, 115, 118, 110, 113, 105, 108, 100];
    const r = classifyStructureSingle(series(closes));
    expect(r.direction).toBe("DOWN");
    expect(r.strength).toBeGreaterThan(30);
  });

  it("marks alternating chop as NEUTRAL with low strength", () => {
    const closes = [100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102];
    const r = classifyStructureSingle(series(closes));
    expect(r.direction).toBe("NEUTRAL");
    expect(r.strength).toBeLessThanOrEqual(30);
  });
});

describe("classifyStructure (multi-timeframe)", () => {
  it("gives higher timeframe more weight when they disagree", () => {
    const up = series([100, 105, 102, 110, 107, 115, 112, 120, 117, 125, 122, 130]);
    const down = series([130, 125, 128, 120, 123, 115, 118, 110, 113, 105, 108, 100]);
    // 1m down, 5m up → 5m should dominate
    const r = classifyStructure(down, up, []);
    expect(r.direction).toBe("UP");
  });

  it("does not let the final candle alone decide direction", () => {
    // Long uptrend on 5m, single red candle at end of 1m
    const up5 = series([100, 105, 102, 110, 107, 115, 112, 120, 117, 125, 122, 130]);
    const up1WithRedTail = series([100, 105, 102, 110, 107, 115, 112, 120, 117, 125, 122, 118]);
    const r = classifyStructure(up1WithRedTail, up5, []);
    expect(r.direction).toBe("UP");
  });
});
