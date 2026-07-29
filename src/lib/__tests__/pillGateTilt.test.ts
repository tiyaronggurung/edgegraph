import { describe, it, expect } from "vitest";
import { pillGateTilt } from "../ourOdds";

const MID = 100_000;
// strike offset in dollars ≈ bps at BTC 100k (1bps = $10)
function tilt(strikeOffset: number, T: number, pills?: { buy?: number; sell?: number }) {
  return pillGateTilt({
    spot: MID,
    strike: MID + strikeOffset,
    midPrice: MID,
    buyPrice: pills?.buy ?? null,
    sellPrice: pills?.sell ?? null,
    secondsToClose: T,
  });
}

describe("pillGateTilt — MID-distance table", () => {
  it("D (at MID) has no edge at any horizon", () => {
    for (const T of [20, 90, 240, 500, 900]) expect(tilt(20, T)).toBe(0);
  });

  it("C (-10..-5bps) has no stable sign → 0", () => {
    for (const T of [20, 90, 240, 500]) expect(tilt(-80, T)).toBe(0);
  });

  it("E (+5..10bps) stays DOWN out to 10m", () => {
    expect(tilt(80, 60)).toBeLessThan(0);
    expect(tilt(80, 240)).toBeLessThan(0);
    expect(tilt(80, 500)).toBeLessThan(0); // was 0 before the re-fit
  });

  it("F/G invert past 10m — never tilt DOWN there", () => {
    expect(tilt(150, 900)).toBe(0);
    expect(tilt(400, 900)).toBe(0);
  });

  it("A (≤-25bps) tilts UP at every horizon including >10m", () => {
    expect(tilt(-300, 60)).toBeGreaterThan(0);
    expect(tilt(-300, 240)).toBeGreaterThan(0);
    expect(tilt(-300, 500)).toBeGreaterThan(0);
    expect(tilt(-300, 1200)).toBeGreaterThan(0);
  });

  it("B (-25..-10bps) tilts UP but weaker than A, and dies by 10m", () => {
    expect(tilt(-150, 60)).toBeGreaterThan(0);
    expect(tilt(-150, 60)).toBeLessThan(tilt(-300, 60));
    expect(tilt(-150, 900)).toBe(0);
  });

  it("UP amplifier needs a $25 gap, not $5", () => {
    const base = tilt(-300, 200);
    const tooClose = tilt(-300, 200, { sell: MID - 300 + 5 });
    const wideEnough = tilt(-300, 200, { sell: MID - 300 + 30 });
    expect(tooClose).toBe(base);
    expect(wideEnough).toBeGreaterThan(base);
  });

  it("stays inside the ±10¢ cap", () => {
    for (const off of [-500, -300, -150, -80, 0, 80, 150, 500]) {
      for (const T of [10, 100, 250, 500, 1200]) {
        expect(Math.abs(tilt(off, T, { buy: MID - 400, sell: MID + 400 }))).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });
});
