import { describe, it, expect } from "vitest";
import { volumeTilt } from "@/lib/ourOdds";

describe("volumeTilt", () => {
  it("is zero without data", () => {
    expect(volumeTilt(null, 600)).toBe(0);
    expect(volumeTilt(undefined, 600)).toBe(0);
  });
  it("is off inside the last 2 minutes (no measured edge)", () => {
    expect(volumeTilt(0.9, 119)).toBe(0);
    expect(volumeTilt(-0.9, 30)).toBe(0);
  });
  it("ignores weak imbalance below the floor", () => {
    expect(volumeTilt(0.14, 600)).toBe(0);
  });
  it("leans UP on net buying and DOWN on net selling, capped at 2c", () => {
    expect(volumeTilt(0.25, 600)).toBeGreaterThan(0);
    expect(volumeTilt(0.25, 600)).toBeLessThan(0.02);
    expect(volumeTilt(0.9, 600)).toBeCloseTo(0.02, 6);
    expect(volumeTilt(-0.9, 600)).toBeCloseTo(-0.02, 6);
  });
});
