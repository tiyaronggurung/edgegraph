import { describe, expect, it } from "vitest";
import { dailyLossHit, liveContracts, liveWindowPnl, orderSpec } from "./live";

describe("5m live trading rules", () => {
  it("buys UP at the UP ask as long price", () => {
    expect(orderSpec("buy", "UP", 0.6)).toEqual({ intent: "ORDER_INTENT_BUY_LONG", longPx: 0.6 });
  });
  it("buys DOWN at a 40¢ ask by sending 60¢ long price", () => {
    expect(orderSpec("buy", "DOWN", 0.4)).toEqual({ intent: "ORDER_INTENT_BUY_SHORT", longPx: 0.6 });
  });
  it("sells DOWN at an 88¢ bid as 12¢ long price", () => {
    expect(orderSpec("sell", "DOWN", 0.88)).toEqual({ intent: "ORDER_INTENT_SELL_SHORT", longPx: 0.12 });
  });
  it("$10 at 60¢ buys 16 contracts", () => {
    expect(liveContracts(0.6)).toBe(16);
  });
  it("held winners pay $1 each", () => {
    expect(liveWindowPnl({ side: "UP", filled: 16, cost: 9.6, soldQty: 0, proceeds: 0 }, "UP")).toBe(6.4);
  });
  it("sold position uses proceeds only", () => {
    expect(liveWindowPnl({ side: "UP", filled: 16, cost: 9.6, soldQty: 16, proceeds: 14.08 }, "DOWN")).toBe(4.48);
  });
  it("stops at $500 of losses in a day", () => {
    expect(dailyLossHit([-300, 50, -200])).toBe(true);
    expect(dailyLossHit([-499.99])).toBe(false);
  });
});
