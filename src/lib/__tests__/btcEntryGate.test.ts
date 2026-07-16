import { describe, it, expect } from "vitest";
import {
  evaluateBtcEntry,
  computeSideConfidence,
  estimateKalshiFeeProb,
  DEFAULT_BTC_GATE_CONFIG,
  type BtcGateConfig,
} from "../btcEntryGate";

const cfg = (over: Partial<BtcGateConfig> = {}): BtcGateConfig => ({
  ...DEFAULT_BTC_GATE_CONFIG,
  ...over,
});

describe("computeSideConfidence", () => {
  it("YES side, model_prob 0.92 → side_conf 0.92", () => {
    expect(computeSideConfidence("YES", 0.92)).toBeCloseTo(0.92, 10);
  });
  it("NO side, model_prob 0.08 → side_conf 0.92", () => {
    expect(computeSideConfidence("NO", 0.08)).toBeCloseTo(0.92, 10);
  });
  it("NO side, model_prob 0.92 → side_conf 0.08", () => {
    expect(computeSideConfidence("NO", 0.92)).toBeCloseTo(0.08, 10);
  });
});

describe("evaluateBtcEntry — side confidence gate", () => {
  it("BET when sideConfidence ≥ min_side_confidence (0.90)", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: 0.94, noAsk: 0.06, config: cfg(),
    });
    expect(d.action).toBe("BET");
    expect(d.gates.sideConfidencePassed).toBe(true);
    expect(d.sideConfidence).toBeCloseTo(0.92, 10);
  });

  it("PASS when sideConfidence < min_side_confidence", () => {
    const d = evaluateBtcEntry({
      lockedSide: "NO", liveSide: "NO", modelProb: 0.92,  // side_conf 0.08
      yesAsk: 0.94, noAsk: 0.06, config: cfg(),
    });
    expect(d.action).toBe("PASS");
    expect(d.gates.sideConfidencePassed).toBe(false);
    expect(d.reason).toMatch(/low side-confidence/);
    expect(d.reason).toMatch(/8%/);
  });

  it("thresholds are configurable — 0.60 lets 0.65 through", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.65,
      yesAsk: 0.7, noAsk: 0.3, config: cfg({ min_side_confidence: 0.60 }),
    });
    expect(d.action).toBe("BET");
  });

  it("thresholds are configurable — 0.95 blocks 0.92", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: 0.94, noAsk: 0.06, config: cfg({ min_side_confidence: 0.95 }),
    });
    expect(d.action).toBe("PASS");
  });
});

describe("evaluateBtcEntry — kill switch", () => {
  it("gate disabled → BET regardless of confidence, all gates marked passed", () => {
    const d = evaluateBtcEntry({
      lockedSide: "NO", liveSide: "NO", modelProb: 0.99,  // side_conf 0.01
      yesAsk: 0.99, noAsk: 0.01, config: cfg({ btc_entry_gate_enabled: false }),
    });
    expect(d.action).toBe("BET");
    expect(d.reason).toMatch(/kill switch/);
    expect(d.gates.sideConfidencePassed).toBe(true);
    expect(d.gates.liveAgreementPassed).toBe(true);
  });
});

describe("evaluateBtcEntry — live-side agreement gate", () => {
  it("live disagreement is logged but not enforced by default", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "NO", modelProb: 0.92,
      yesAsk: 0.94, noAsk: 0.06, config: cfg(),  // require_live_side_agreement: false
    });
    expect(d.action).toBe("BET");
    expect(d.liveSideDisagrees).toBe(true);
    expect(d.gates.liveAgreementPassed).toBe(true); // shadow — treated as passing
    expect(d.reason).toMatch(/live-side disagrees/);
  });

  it("PASS when require_live_side_agreement=true and live disagrees", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "NO", modelProb: 0.92,
      yesAsk: 0.94, noAsk: 0.06,
      config: cfg({ require_live_side_agreement: true }),
    });
    expect(d.action).toBe("PASS");
    expect(d.gates.liveAgreementPassed).toBe(false);
    expect(d.reason).toMatch(/live model side/);
  });
});

describe("evaluateBtcEntry — positive calibrated edge", () => {
  it("estimated fee = 0.07 * p * (1-p)", () => {
    expect(estimateKalshiFeeProb(0.5)).toBeCloseTo(0.0175, 10);
    expect(estimateKalshiFeeProb(0.94)).toBeCloseTo(0.07 * 0.94 * 0.06, 10);
  });

  it("YES: rawEdge = modelProb - yesAsk", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: 0.94, noAsk: 0.06, config: cfg(),
    });
    expect(d.selectedSideAsk).toBeCloseTo(0.94, 10);
    expect(d.rawModelEdge).toBeCloseTo(0.92 - 0.94, 10);
    expect(d.gates.positiveEdgePassed).toBe(false); // negative edge
  });

  it("NO: rawEdge = (1-modelProb) - noAsk", () => {
    const d = evaluateBtcEntry({
      lockedSide: "NO", liveSide: "NO", modelProb: 0.05,  // side_conf 0.95
      yesAsk: 0.05, noAsk: 0.15, config: cfg(),
    });
    expect(d.selectedSideAsk).toBeCloseTo(0.15, 10);
    expect(d.rawModelEdge).toBeCloseTo(0.95 - 0.15, 10);
    expect(d.gates.positiveEdgePassed).toBe(true);
  });

  it("shadow mode: positive edge NEVER blocks a BET", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: 0.99, noAsk: 0.01, // huge negative edge
      config: cfg({ positive_edge_mode: "shadow" }),
    });
    expect(d.action).toBe("BET");
    expect(d.gates.positiveEdgePassed).toBe(false);
    expect(d.positiveEdgeShadowPass).toBe(false);
  });

  it("enforced mode: positive edge required — PASS if negative", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: 0.99, noAsk: 0.01,
      config: cfg({ positive_edge_mode: "enforced" }),
    });
    expect(d.action).toBe("PASS");
    expect(d.reason).toMatch(/calibrated edge/);
  });

  it("enforced mode + missing ask → PASS with clear reason", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: null, noAsk: null,
      config: cfg({ positive_edge_mode: "enforced" }),
    });
    expect(d.action).toBe("PASS");
    expect(d.gates.positiveEdgePassed).toBe(null);
    expect(d.reason).toMatch(/ask unavailable/);
  });

  it("slippage buffer reduces effective edge", () => {
    // rawEdge = 0.03, fee ≈ 0.07*0.92*0.08 ≈ 0.00515 → feeAdj ≈ 0.02485
    // with slippage 0.03 → slipAdj ≈ -0.00515 → fails
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.95,
      yesAsk: 0.92, noAsk: 0.08,
      config: cfg({ positive_edge_mode: "enforced", slippage_buffer_prob: 0.03 }),
    });
    expect(d.gates.positiveEdgePassed).toBe(false);
    expect(d.slippageAdjustedEdge).toBeLessThan(0);
  });
});

describe("evaluateBtcEntry — output shape (contract)", () => {
  it("returns the exact spec shape", () => {
    const d = evaluateBtcEntry({
      lockedSide: "YES", liveSide: "YES", modelProb: 0.92,
      yesAsk: 0.94, noAsk: 0.06, config: cfg(),
    });
    expect(d).toEqual(
      expect.objectContaining({
        action: expect.any(String),
        reason: expect.any(String),
        sideConfidence: expect.any(Number),
        liveSide: expect.any(String),
        lockedSide: expect.any(String),
        gates: expect.objectContaining({
          sideConfidencePassed: expect.any(Boolean),
          liveAgreementPassed: expect.any(Boolean),
        }),
      }),
    );
    expect(["BET", "PASS"]).toContain(d.action);
    expect(d.gates.positiveEdgePassed === null || typeof d.gates.positiveEdgePassed === "boolean").toBe(true);
    expect(d.calibratedEdge === null || typeof d.calibratedEdge === "number").toBe(true);
  });
});

describe("default production config", () => {
  it("matches the deployed production values", () => {
    expect(DEFAULT_BTC_GATE_CONFIG.btc_entry_gate_enabled).toBe(true);
    expect(DEFAULT_BTC_GATE_CONFIG.min_side_confidence).toBe(0.90);
    expect(DEFAULT_BTC_GATE_CONFIG.require_live_side_agreement).toBe(false);
    expect(DEFAULT_BTC_GATE_CONFIG.positive_edge_mode).toBe("shadow");
    expect(DEFAULT_BTC_GATE_CONFIG.min_calibrated_edge_points).toBe(0);
    expect(DEFAULT_BTC_GATE_CONFIG.log_gate_decisions).toBe(true);
  });
});
