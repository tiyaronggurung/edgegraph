import { describe, it, expect } from "vitest";
import {
  evaluateSecondLeg,
  evaluateHedgeExit,
  effectiveLegCost,
} from "@/lib/opsManual/hedgeEngine";

const pos = (o: Partial<Parameters<typeof evaluateSecondLeg>[0]> = {}) => ({
  sideA: "YES",
  sharesA: 100,
  avgCostA: 40,
  sharesB: 0,
  dominantSidePrice: 45,
  sideSpendUsd: 0,
  windowSpendUsd: 0,
  ...o,
});

describe("two-sided hedge engine", () => {
  it("buys the opposite leg when the pair is under 96¢", () => {
    const r = evaluateSecondLeg(pos(), { oppAskCents: 50, secondsLeft: 600 });
    expect(r.decision).toBe("BUY");
    expect(r.side).toBe("NO");
    expect(r.shares).toBe(100);
    expect(r.pairCostCents).toBeLessThanOrEqual(96);
  });

  it("skips when the pair costs more than 96¢", () => {
    const r = evaluateSecondLeg(pos({ avgCostA: 60 }), { oppAskCents: 40, secondsLeft: 600 });
    expect(r.decision).toBe("SKIP");
    expect(r.reason).toBe("arb_test_failed");
  });

  it("blocks absolutely when the dominant side is ≥70¢, even if the arb test would pass", () => {
    const r = evaluateSecondLeg(pos({ avgCostA: 20, dominantSidePrice: 72 }), {
      oppAskCents: 15,
      secondsLeft: 600,
    });
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("dominance_block");
  });

  it("refuses new legs inside T−5m", () => {
    const r = evaluateSecondLeg(pos(), { oppAskCents: 40, secondsLeft: 240 });
    expect(r.decision).toBe("SKIP");
    expect(r.reason).toBe("inside_t5m");
  });

  it("never buys more than the imbalance", () => {
    const r = evaluateSecondLeg(pos({ sharesA: 100, sharesB: 80 }), {
      oppAskCents: 40,
      secondsLeft: 600,
    });
    expect(r.shares).toBe(20);
  });

  it("respects the per-side cap", () => {
    const r = evaluateSecondLeg(pos({ sideSpendUsd: 300 }), { oppAskCents: 40, secondsLeft: 600 });
    expect(r.decision).toBe("SKIP");
    expect(r.reason).toBe("cap_exhausted");
  });

  it("adds slippage and a rounded-up fee to the opposite ask", () => {
    expect(effectiveLegCost(50)).toBeGreaterThan(51);
  });

  it("holds matched pairs but unwinds at ≥99¢ combined bid", () => {
    expect(evaluateHedgeExit({ sharesA: 10, sharesB: 10, pairBidCents: 97 }).unwindPairs).toBe(false);
    expect(evaluateHedgeExit({ sharesA: 10, sharesB: 10, pairBidCents: 99 }).unwindPairs).toBe(true);
  });

  it("exits the naked overhang at 92% of captured upside, any time left", () => {
    const hold = evaluateHedgeExit({
      sharesA: 10,
      sharesB: 4,
      nakedPotentialProfitUsd: 40,
      nakedUnrealisedProfitUsd: 34,
    });
    expect(hold.exitNaked).toBe(false);
    const go = evaluateHedgeExit({
      sharesA: 10,
      sharesB: 4,
      nakedPotentialProfitUsd: 40,
      nakedUnrealisedProfitUsd: 36.8,
    });
    expect(go.exitNaked).toBe(true);
    expect(go.nakedShares).toBe(6);
  });
});
