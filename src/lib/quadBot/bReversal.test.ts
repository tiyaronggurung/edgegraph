import { describe, expect, it } from "vitest";
import { decideBHedge } from "./bReversal";

const base = { heldContracts: 170, heldCost: 99.5 };

describe("decideBHedge", () => {
  it("locks a guaranteed pair after 85 → 65 reversal", () => {
    const d = decideBHedge({ ...base, heldOddsSinceEntry: [0.66, 0.85, 0.7], heldOddsNow: 0.64, oppAsk: 0.3 });
    expect(d?.kind).toBe("lock");
    expect(d!.contracts).toBe(170);
    expect(base.heldCost + d!.cost).toBeLessThan(170);
  });
  it("waits while the trade is still running", () => {
    expect(decideBHedge({ ...base, heldOddsSinceEntry: [0.85], heldOddsNow: 0.8, oppAsk: 0.15 })).toBeNull();
  });
  it("no lock if the pair would cost more than it pays", () => {
    expect(decideBHedge({ ...base, heldOddsSinceEntry: [0.85], heldOddsNow: 0.6, oppAsk: 0.45 })).toBeNull();
  });
  it("rescues a failed trade that never peaked", () => {
    const d = decideBHedge({ ...base, heldOddsSinceEntry: [0.66, 0.5], heldOddsNow: 0.35, oppAsk: 0.48 });
    expect(d?.kind).toBe("rescue");
  });
  it("no rescue once the opposite side is already expensive", () => {
    expect(decideBHedge({ ...base, heldOddsSinceEntry: [0.66], heldOddsNow: 0.3, oppAsk: 0.6 })).toBeNull();
  });
});
