import { describe, it, expect } from "vitest";
import {
  computeGapAnalysis,
  pinRiskFloorSigmas,
  evaluateGate,
  computeRequiredEdgePts,
  type GapAnalysis,
} from "../cryptoBtcGate";

// Helper to build a permissive baseline gap so each gate test isolates one rule.
const safeGap = (overrides: Partial<GapAnalysis> = {}): GapAnalysis => ({
  gapUsd: 500,
  gapPct: 0.85,
  needsToMoveUsd: 0,
  needsDirection: "hold",
  expectedMoveUsd: 200,
  gapInSigmas: 0,
  momentumSign: 0,
  momentumAlignsWithSide: true,
  verdict: "spot above strike by $500 — YES defends · 200$/σ remaining · momentum +0.00 holds",
  ...overrides,
});

// ────────────────────────── gapAnalysis math ──────────────────────────
describe("computeGapAnalysis", () => {
  it("YES with spot above strike: side defends, needsToMoveUsd=0", () => {
    const g = computeGapAnalysis({
      spot: 58_500, strike: 58_300, side: "YES",
      sigmaEff: 0.15, secondsToClose: 240, micro: null,
    });
    expect(g.gapUsd).toBeCloseTo(200, 6);
    expect(g.needsDirection).toBe("hold");
    expect(g.needsToMoveUsd).toBe(0);
    expect(g.gapInSigmas).toBe(0);
    expect(g.verdict).toMatch(/YES defends/);
  });

  it("NO with spot above strike: needs spot to drop to strike", () => {
    const g = computeGapAnalysis({
      spot: 58_289, strike: 58_206, side: "NO",
      sigmaEff: 0.15, secondsToClose: 128, micro: null,
    });
    // Replicates the 12:45 case: spot $83 above a NO strike, ~2min left.
    expect(g.needsDirection).toBe("down");
    expect(g.needsToMoveUsd).toBeCloseTo(-83, 0); // strike - spot = -83
    expect(g.gapInSigmas).toBeGreaterThan(0);
    expect(g.gapInSigmas).toBeLessThan(1); // sub-σ traversal needed
    expect(g.verdict).toMatch(/spot must move/);
  });

  it("expectedMoveUsd scales with √(secondsToClose/60)", () => {
    const a = computeGapAnalysis({ spot: 60_000, strike: 60_000, side: "YES", sigmaEff: 0.1, secondsToClose: 60, micro: null });
    const b = computeGapAnalysis({ spot: 60_000, strike: 60_000, side: "YES", sigmaEff: 0.1, secondsToClose: 240, micro: null });
    // 4× the time → 2× the σ-move
    expect(b.expectedMoveUsd / a.expectedMoveUsd).toBeCloseTo(2, 4);
  });

  it("momentum: cvd+ofi avg > 0.05 → +1, < -0.05 → -1, else 0", () => {
    const up = computeGapAnalysis({ spot: 60_000, strike: 60_100, side: "YES", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: 0.4, ofi: 0.2 } });
    const down = computeGapAnalysis({ spot: 60_000, strike: 59_900, side: "NO", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: -0.3, ofi: -0.3 } });
    const flat = computeGapAnalysis({ spot: 60_000, strike: 60_100, side: "YES", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: 0.04, ofi: 0.0 } });
    expect(up.momentumSign).toBe(1);
    expect(down.momentumSign).toBe(-1);
    expect(flat.momentumSign).toBe(0);
  });

  it("momentumAlignsWithSide: YES wants up, NO wants down", () => {
    // YES needs spot up, momentum up → aligned
    const ya = computeGapAnalysis({ spot: 60_000, strike: 60_100, side: "YES", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: 0.5, ofi: 0.5 } });
    // YES needs spot up, momentum down → fights
    const yf = computeGapAnalysis({ spot: 60_000, strike: 60_100, side: "YES", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: -0.5, ofi: -0.5 } });
    // NO needs spot down, momentum down → aligned
    const na = computeGapAnalysis({ spot: 60_000, strike: 59_900, side: "NO", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: -0.5, ofi: -0.5 } });
    expect(ya.momentumAlignsWithSide).toBe(true);
    expect(yf.momentumAlignsWithSide).toBe(false);
    expect(na.momentumAlignsWithSide).toBe(true);
  });

  it("flat momentum is treated as aligned (don't punish neutrality)", () => {
    const g = computeGapAnalysis({ spot: 60_000, strike: 60_050, side: "YES", sigmaEff: 0.1, secondsToClose: 120, micro: { cvdRatio: 0, ofi: 0 } });
    expect(g.momentumSign).toBe(0);
    expect(g.momentumAlignsWithSide).toBe(true);
  });
});

// ────────────────────────── time-scaled σ floor ──────────────────────────
describe("pinRiskFloorSigmas", () => {
  it("0.5σ when >3min remaining", () => {
    expect(pinRiskFloorSigmas(181)).toBe(0.5);
    expect(pinRiskFloorSigmas(600)).toBe(0.5);
  });
  it("1.0σ when ≤3min and >90s", () => {
    expect(pinRiskFloorSigmas(180)).toBe(1.0);
    expect(pinRiskFloorSigmas(91)).toBe(1.0);
  });
  it("1.5σ when ≤90s", () => {
    expect(pinRiskFloorSigmas(90)).toBe(1.5);
    expect(pinRiskFloorSigmas(45)).toBe(1.5);
  });
});

// ────────────────────────── gate decisions ──────────────────────────
describe("evaluateGate", () => {
  const baseInput = {
    side: "YES" as const,
    secondsToClose: 240,
    yesPrice: 0.50,
    sigDist: 2.0,
    edgeAbs: 5.0,
    requiredEdgePts: 3.0,
    kelly: 0.1,
    gap: safeGap(),
  };

  it("BET when all conditions favorable", () => {
    expect(evaluateGate(baseInput).gateAction).toBe("BET");
  });

  it("PASS on <30s to expiry", () => {
    const r = evaluateGate({ ...baseInput, secondsToClose: 25 });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/too close to expiry/);
  });

  it("PASS on pinned yesPrice (≤2¢ or ≥98¢)", () => {
    expect(evaluateGate({ ...baseInput, yesPrice: 0.01 }).gateReason).toMatch(/price pinned/);
    expect(evaluateGate({ ...baseInput, yesPrice: 0.99 }).gateReason).toMatch(/price pinned/);
  });

  // ── Pin-risk gate, the regression we explicitly want to prevent ──
  it("PASS in pin-risk zone at <0.5σ with >3min left", () => {
    const r = evaluateGate({ ...baseInput, secondsToClose: 240, sigDist: 0.3 });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/coin-flip zone/);
    expect(r.gateReason).toMatch(/floor 0.5σ/);
  });

  it("PASS in pin-risk zone at <1.0σ inside 3min", () => {
    const r = evaluateGate({ ...baseInput, secondsToClose: 150, sigDist: 0.9 });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/floor 1.0σ/);
  });

  it("PASS in pin-risk zone at <1.5σ inside 90s", () => {
    // Need >60s to hit the pin-risk branch (≤60s is allowed for slippage-only gate).
    const r = evaluateGate({ ...baseInput, secondsToClose: 75, sigDist: 1.4 });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/floor 1.5σ/);
  });

  it("BET allowed exactly at floor boundaries (≥ floor passes)", () => {
    // Exactly at 0.5σ with 4min left should NOT trip pin-risk (strict <).
    const r = evaluateGate({ ...baseInput, secondsToClose: 240, sigDist: 0.5 });
    expect(r.gateAction).toBe("BET");
  });

  it("REGRESSION: 12:45 case — 0.29σ at 128s must PASS (not BET)", () => {
    // Real production miss: sigDist 0.29σ, 128s to close, 2.5pt edge would
    // have been a BET under the old 0.5σ-always floor; new floor at 128s
    // is 1.0σ, so this MUST pass.
    const r = evaluateGate({
      ...baseInput,
      side: "NO",
      secondsToClose: 128,
      sigDist: 0.29,
      edgeAbs: 2.5,
      requiredEdgePts: 2.0,
      gap: safeGap({ needsDirection: "down", needsToMoveUsd: -83, gapInSigmas: 0.29 }),
    });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/coin-flip zone/);
  });

  // ── Traversal blocks ──
  it("PASS when gap >1σ AND momentum fights the side", () => {
    const r = evaluateGate({
      ...baseInput,
      sigDist: 2.0,
      gap: safeGap({ needsDirection: "up", needsToMoveUsd: 300, gapInSigmas: 1.2, momentumAlignsWithSide: false, momentumSign: -1 }),
    });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/traversal block/);
  });

  it("BET when gap >1σ but momentum HELPS the side", () => {
    const r = evaluateGate({
      ...baseInput,
      sigDist: 2.0,
      gap: safeGap({ needsDirection: "up", needsToMoveUsd: 300, gapInSigmas: 1.2, momentumAlignsWithSide: true, momentumSign: 1 }),
    });
    expect(r.gateAction).toBe("BET");
  });

  it("PASS when gap >1.5σ regardless of momentum", () => {
    const r = evaluateGate({
      ...baseInput,
      sigDist: 2.0,
      gap: safeGap({ needsDirection: "up", needsToMoveUsd: 600, gapInSigmas: 1.7, momentumAlignsWithSide: true, momentumSign: 1 }),
    });
    expect(r.gateAction).toBe("PASS");
    expect(r.gateReason).toMatch(/gap too wide/);
  });

  it("traversal blocks don't apply when side is currently winning", () => {
    const r = evaluateGate({
      ...baseInput,
      gap: safeGap({ needsDirection: "hold", gapInSigmas: 0, momentumAlignsWithSide: false }),
    });
    expect(r.gateAction).toBe("BET");
  });

  it("PASS when edge below required", () => {
    expect(evaluateGate({ ...baseInput, edgeAbs: 2.0, requiredEdgePts: 3.0 }).gateReason).toMatch(/edge .* < required/);
  });

  it("PASS when Kelly ≤ 0", () => {
    expect(evaluateGate({ ...baseInput, kelly: 0 }).gateReason).toMatch(/Kelly fraction ≤ 0/);
  });
});

// ────────────────────────── required-edge composition ──────────────────────────
describe("computeRequiredEdgePts", () => {
  const noMicro = {};

  it("cold-start: base 3 + cold-calib 0.5 = 3.5", () => {
    const r = computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: noMicro, calibBrier: null, calibN: 0 });
    expect(r.parts.base).toBe(3);
    expect(r.parts.calib).toBe(0.5);
    expect(r.requiredEdgePts).toBeCloseTo(3.5, 6);
  });

  it("calibration term scales with Brier above 0.20", () => {
    // Brier 0.30 → (0.30-0.20)*30 = 3.0
    const r = computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: noMicro, calibBrier: 0.30, calibN: 100 });
    expect(r.parts.calib).toBeCloseTo(3.0, 6);
  });

  it("calibration term clamps at [0, 4]", () => {
    const low = computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: noMicro, calibBrier: 0.10, calibN: 100 });
    const high = computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: noMicro, calibBrier: 0.50, calibN: 100 });
    expect(low.parts.calib).toBe(0);
    expect(high.parts.calib).toBe(4);
  });

  it("time term: +2 if <60s, +1 if <300s, else 0", () => {
    expect(computeRequiredEdgePts({ side: "YES", secondsToClose: 45, micro: noMicro, calibBrier: 0.20, calibN: 100 }).parts.time).toBe(2);
    expect(computeRequiredEdgePts({ side: "YES", secondsToClose: 200, micro: noMicro, calibBrier: 0.20, calibN: 100 }).parts.time).toBe(1);
    expect(computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: noMicro, calibBrier: 0.20, calibN: 100 }).parts.time).toBe(0);
  });

  it("spread term: +2 if >10bps, +1 if >5bps", () => {
    expect(computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: { bookSpreadBps: 12 }, calibBrier: 0.20, calibN: 100 }).parts.spread).toBe(2);
    expect(computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: { bookSpreadBps: 7 }, calibBrier: 0.20, calibN: 100 }).parts.spread).toBe(1);
    expect(computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: { bookSpreadBps: 3 }, calibBrier: 0.20, calibN: 100 }).parts.spread).toBe(0);
  });

  it("regime term: +1.5 when funding or basis stretched", () => {
    const stretched = computeRequiredEdgePts({ side: "YES", secondsToClose: 600, micro: { fundingRate: 0.0002 }, calibBrier: 0.20, calibN: 100 });
    expect(stretched.parts.regime).toBe(1.5);
  });

  it("whale flow aligned with side LOWERS bar (-1.0pts)", () => {
    const r = computeRequiredEdgePts({
      side: "YES", secondsToClose: 600,
      micro: { whaleImbalance1m: 0.8, whaleBuyUsd1m: 600_000, whaleSellUsd1m: 100_000 },
      calibBrier: 0.20, calibN: 100,
    });
    expect(r.parts.whale).toBe(-1.0);
  });

  it("whale flow against side RAISES bar (+1.5pts)", () => {
    const r = computeRequiredEdgePts({
      side: "YES", secondsToClose: 600,
      micro: { whaleImbalance1m: -0.8, whaleBuyUsd1m: 100_000, whaleSellUsd1m: 600_000 },
      calibBrier: 0.20, calibN: 100,
    });
    expect(r.parts.whale).toBe(1.5);
  });

  it("whale signal ignored when notional below $500k threshold", () => {
    const r = computeRequiredEdgePts({
      side: "YES", secondsToClose: 600,
      micro: { whaleImbalance1m: 0.9, whaleBuyUsd1m: 200_000, whaleSellUsd1m: 100_000 },
      calibBrier: 0.20, calibN: 100,
    });
    expect(r.parts.whale).toBe(0);
  });

  it("required edge floored at 1.5pts even with all negative terms", () => {
    const r = computeRequiredEdgePts({
      side: "YES", secondsToClose: 600,
      micro: { whaleImbalance1m: 0.8, whaleBuyUsd1m: 600_000, whaleSellUsd1m: 100_000 },
      calibBrier: 0.10, calibN: 100, // calib clamps to 0
    });
    // 3 + 0 + 0 + 0 + 0 + (-1) = 2 → above floor, ok
    expect(r.requiredEdgePts).toBe(2);
    // Stress: only the base would give 3 + (-1) = 2; floor doesn't bite here but is enforced as max(1.5, ...)
    expect(r.requiredEdgePts).toBeGreaterThanOrEqual(1.5);
  });
});
