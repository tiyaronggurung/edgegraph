import { describe, expect, it } from "vitest";
import { expirationWeightedArea } from "./expirationWeightedArea";

const start = Date.parse("2026-10-15T19:45:00Z");
const series = (seconds: number, value: (s: number) => number) =>
  Array.from({ length: seconds + 1 }, (_, s) => ({ t: start + s * 1000, up: value(s) }));

describe("50-lobe expiration-weighted display area", () => {
  it("reads 50/50 at the midline and full conviction for one-sided windows", () => {
    expect(expirationWeightedArea(series(900, () => 0.5), start)?.upPct).toBeCloseTo(50, 8);
    expect(expirationWeightedArea(series(900, () => 0.52), start)?.upPct).toBeCloseTo(100, 8);
    expect(expirationWeightedArea(series(900, () => 0.2), start)?.downPct).toBeCloseTo(100, 8);
  });
  it("sums to 100", () => {
    const r = expirationWeightedArea(series(900, s => 0.5 + 0.3 * Math.sin(s / 60)), start);
    expect((r?.upPct ?? 0) + (r?.downPct ?? 0)).toBeCloseTo(100, 8);
  });
  it("gives a sustained late reversal more influence", () => {
    expect(expirationWeightedArea(series(900, s => s < 750 ? 0.8 : 0.037), start)?.downPct).toBeGreaterThan(50);
  });
  it("is symmetric between UP and DOWN", () => {
    const points = series(900, s => s < 720 ? 0.5 : s < 780 ? 0.1 : 0.9);
    const up = expirationWeightedArea(points, start);
    const down = expirationWeightedArea(points.map(p => ({ ...p, up: 1 - p.up })), start);
    expect(up?.upPct).toBeGreaterThan(50);
    expect(up?.upPct).toBeCloseTo(down?.downPct ?? 0, 8);
  });
  it("splits a crossing segment exactly at 50", () => {
    const r = expirationWeightedArea([{ t: start, up: 0.4 }, { t: start + 1000, up: 0.6 }], start);
    expect(r?.upPct).toBeCloseTo(50, 8);
  });
  it("ignores empty, duplicate, invalid and out-of-window intervals", () => {
    expect(expirationWeightedArea([], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start, up: 0.5 }, { t: start, up: 0.5 }], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start - 1000, up: 1 }, { t: start, up: 1 }], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start, up: NaN }, { t: start + 1000, up: 1 }], start)).toBeNull();
    expect(expirationWeightedArea([{ t: start + 900000, up: 1 }, { t: start + 901000, up: 1 }], start)).toBeNull();
  });
});
