import { describe, expect, it } from "vitest";
import { expirationWeightedArea } from "./expirationWeightedArea";

const start = Date.parse("2026-10-15T19:45:00Z");
const series = (seconds: number, value: (s: number) => number) =>
  Array.from({ length: seconds + 1 }, (_, s) => ({ t: start + s * 1000, up: value(s) }));

describe("expiration-weighted display area", () => {
  it("preserves constant probabilities and a 100% combined area", () => {
    for (const up of [0, 0.5, 0.52, 1]) {
      const result = expirationWeightedArea(series(900, () => up), start);
      expect(result?.upPct).toBeCloseTo(up * 100, 8);
      expect((result?.upPct ?? 0) + (result?.downPct ?? 0)).toBeCloseTo(100, 8);
    }
  });
  it("gives a sustained late reversal more influence than flat area", () => {
    const result = expirationWeightedArea(series(900, s => s < 750 ? 0.8 : 0.037), start);
    expect(result?.downPct).toBeGreaterThan(50);
    expect(0.8 * 750 / 900 + 0.037 * 150 / 900).toBeGreaterThan(0.5);
  });
  it("handles a final dump then pump symmetrically without guaranteeing settlement", () => {
    const points = series(900, s => s < 720 ? 0.5 : s < 780 ? 0.1 : 0.9);
    const up = expirationWeightedArea(points, start);
    const down = expirationWeightedArea(points.map(p => ({ ...p, up: 1 - p.up })), start);
    expect(up?.upPct).toBeGreaterThan(50);
    expect(up?.upPct).toBeCloseTo(down?.downPct ?? 0, 8);
    // A last-second move need not erase earlier weighted history.
    expect(expirationWeightedArea(series(900, s => s < 899 ? 0.1 : 0.99), start)?.upPct).toBeLessThan(50);
  });
  it("uses the same fixed expiry for a partial live window and replay", () => {
    const points = series(420, s => s < 360 ? 0.8 : 0.1);
    const result = expirationWeightedArea(points, start);
    expect(result?.upPct).toBeGreaterThan(50);
    expect(result?.upPct).toBeLessThan(70);
  });
  it("ignores empty, duplicate, invalid and out-of-window intervals", () => {
    expect(expirationWeightedArea([], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start, up: 0.5 }, { t: start, up: 0.5 }], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start - 1000, up: 1 }, { t: start, up: 1 }], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start, up: NaN }, { t: start + 1000, up: 1 }], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start + 900000, up: 1 }, { t: start + 901000, up: 1 }], start)).toBeNull();
  });
  it("caps credited recording gaps at ten seconds", () => {
    const result = expirationWeightedArea([
      { t: start, up: 1 }, { t: start + 1000, up: 1 },
      { t: start + 600000, up: 0 }, { t: start + 601000, up: 0 },
    ], start);
    expect(result?.upPct).toBeGreaterThan(40);
    expect(result?.upPct).toBeLessThan(50);
  });
});