import { describe, expect, it } from "vitest";
import { calculateCSettlement } from "./cSettlement";

describe("C settlement", () => {
  const position = { up_ct: 416, down_ct: 441, up_cost: 149.76, down_cost: 149.94 };
  it("pays only UP contracts and deducts both legs", () => {
    expect(calculateCSettlement({ ...position, result: "UP" })).toEqual({ payout: 416, cost: 299.7, pnl: 116.3 });
  });
  it("pays only DOWN contracts when their count differs", () => {
    expect(calculateCSettlement({ ...position, result: "DOWN" })).toEqual({ payout: 441, cost: 299.7, pnl: 141.3 });
  });
  it("can lose despite a completed equal-dollar hedge", () => {
    expect(calculateCSettlement({ up_ct: 220, down_ct: 750, up_cost: 149.6, down_cost: 150, result: "UP" })?.pnl).toBe(-79.6);
  });
  it("preserves an actual historical C settlement without resizing its fills", () => {
    expect(calculateCSettlement({ up_ct: "226", down_ct: "226", up_cost: "33.29", down_cost: "149.34", result: "UP" })?.pnl).toBe(43.37);
  });
  it("uses recorded fee-inclusive costs once", () => {
    expect(calculateCSettlement({ up_ct: 200, down_ct: 0, up_cost: 125.1, down_cost: 0, result: "UP" })?.pnl).toBe(74.9);
  });
  it("does not assign a profit before the result exists or with invalid amounts", () => {
    expect(calculateCSettlement({ ...position, result: null })).toBeNull();
    expect(calculateCSettlement({ ...position, up_cost: "bad", result: "UP" })).toBeNull();
  });
});