import { describe, expect, it } from "vitest";
import { sizeCEqualDollarHedge } from "./cHedgeSizing";

describe("C equal-dollar hedge", () => {
  it("spends the same budget rather than matching first-leg contracts", () => {
    expect(sizeCEqualDollarHedge(150, 0.4)).toBe(375);
    expect(sizeCEqualDollarHedge(150, 0.3)).toBe(500);
  });
  it("rounds down whole contracts without exceeding the budget", () => {
    const ct = sizeCEqualDollarHedge(150, 0.43);
    expect(ct).toBe(348);
    expect(ct * 0.43).toBeLessThanOrEqual(150);
    expect((ct + 1) * 0.43).toBeGreaterThan(150);
  });
  it("rejects invalid prices and budgets", () => {
    for (const price of [0, -0.1, 1, NaN, Infinity]) expect(sizeCEqualDollarHedge(150, price)).toBe(0);
    for (const budget of [0, -1, NaN, Infinity]) expect(sizeCEqualDollarHedge(budget, 0.4)).toBe(0);
  });
  it("equal dollar legs can still lose on one outcome", () => {
    const up = sizeCEqualDollarHedge(150, 0.6);
    const down = sizeCEqualDollarHedge(150, 0.25);
    expect(up - 300).toBe(-50);
    expect(down - 300).toBe(300);
  });
});