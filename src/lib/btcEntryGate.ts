// Central BTC entry gate — shared decision function called by every automatic
// entry path (live market, stored-prediction fallback, auto_model_bet_tick).
//
// Pure and synchronous — no I/O, no side effects. Callers persist the result
// via logBtcGateDecision() in btcGateLog.server.ts.
//
// Existing structural gates (pin-risk, gap traversal, edge threshold, kelly)
// remain in cryptoBtcGate.ts::evaluateGate. This module owns three NEW gates:
//   1) side confidence     — locked side must still be model-favored
//   2) live-side agreement — locked side must match the current live call
//   3) positive calibrated edge — modelProb(selected) − ask − fee − slip > threshold
//
// gates.positiveEdgePassed is `null` when order-book ask isn't available
// (positive edge can't be evaluated without an executable price).

export type Side = "YES" | "NO";
export type SourcePath = "live_market" | "stored_prediction_fallback" | "auto_model_bet_tick";
export type PositiveEdgeMode = "off" | "shadow" | "enforced";

export interface BtcGateConfig {
  btc_entry_gate_enabled: boolean;
  min_side_confidence: number;
  require_live_side_agreement: boolean;
  positive_edge_mode: PositiveEdgeMode;
  min_calibrated_edge_points: number;   // in points (0.01 = 1pt)
  slippage_buffer_prob: number;         // 0..1
  log_gate_decisions: boolean;
  config_version: number;
}

export const DEFAULT_BTC_GATE_CONFIG: BtcGateConfig = {
  btc_entry_gate_enabled: true,
  min_side_confidence: 0.90,
  require_live_side_agreement: false,
  positive_edge_mode: "shadow",
  min_calibrated_edge_points: 0,
  slippage_buffer_prob: 0.01,
  log_gate_decisions: true,
  config_version: 1,
};

export interface BtcEntryGateInput {
  lockedSide: Side;
  liveSide: Side;             // caller MUST compute before calling
  modelProb: number;          // P(YES) in [0,1]
  yesAsk?: number | null;     // 0..1
  noAsk?: number | null;      // 0..1
  config: BtcGateConfig;
}

export interface BtcEntryGateDecision {
  action: "BET" | "PASS";
  reason: string;
  sideConfidence: number;
  liveSide: Side;
  lockedSide: Side;
  calibratedEdge: number | null;  // slippage-adjusted, in probability units
  gates: {
    sideConfidencePassed: boolean;
    liveAgreementPassed: boolean;
    positiveEdgePassed: boolean | null;
  };
  // Auxiliary — for logging.
  selectedSideAsk: number | null;
  estimatedFee: number;
  rawModelEdge: number | null;
  feeAdjustedEdge: number | null;
  slippageAdjustedEdge: number | null;
  positiveEdgeShadowPass: boolean;
  allReasons: string[];
  liveSideDisagrees: boolean;
}

// Kalshi fee approximation: 0.07 * price * (1 - price) per contract.
// Applied at the selected side's ask (probability).
export function estimateKalshiFeeProb(askProb: number): number {
  if (!Number.isFinite(askProb) || askProb <= 0 || askProb >= 1) return 0;
  return 0.07 * askProb * (1 - askProb);
}

export function computeSideConfidence(side: Side, modelYesProb: number): number {
  return side === "YES" ? modelYesProb : 1 - modelYesProb;
}

/**
 * Central BTC entry gate. See file header for scope.
 */
export function evaluateBtcEntry(input: BtcEntryGateInput): BtcEntryGateDecision {
  const { lockedSide, liveSide, modelProb, yesAsk, noAsk, config } = input;

  const sideConfidence = computeSideConfidence(lockedSide, modelProb);
  const liveSideDisagrees = liveSide !== lockedSide;

  // ── Selected-side ask (probability units) + fee + edge components ──
  const askRaw = lockedSide === "YES" ? yesAsk : noAsk;
  const selectedSideAsk =
    typeof askRaw === "number" && Number.isFinite(askRaw) && askRaw > 0 && askRaw < 1
      ? askRaw
      : null;
  const estimatedFee = selectedSideAsk !== null ? estimateKalshiFeeProb(selectedSideAsk) : 0;

  let rawModelEdge: number | null = null;
  let feeAdjustedEdge: number | null = null;
  let slippageAdjustedEdge: number | null = null;
  if (selectedSideAsk !== null) {
    const modelSideProb = sideConfidence;
    rawModelEdge = modelSideProb - selectedSideAsk;
    feeAdjustedEdge = rawModelEdge - estimatedFee;
    slippageAdjustedEdge = feeAdjustedEdge - config.slippage_buffer_prob;
  }

  const minEdgeProb = config.min_calibrated_edge_points / 100;
  const positiveEdgePassed: boolean | null =
    slippageAdjustedEdge === null ? null : slippageAdjustedEdge > minEdgeProb;
  const positiveEdgeShadowPass = positiveEdgePassed === true;

  // ── Kill switch: always BET, everything logged, no enforcement ──
  if (!config.btc_entry_gate_enabled) {
    return {
      action: "BET",
      reason: "gate disabled (kill switch)",
      sideConfidence,
      liveSide,
      lockedSide,
      calibratedEdge: slippageAdjustedEdge,
      gates: {
        sideConfidencePassed: true,
        liveAgreementPassed: true,
        positiveEdgePassed,
      },
      selectedSideAsk,
      estimatedFee,
      rawModelEdge,
      feeAdjustedEdge,
      slippageAdjustedEdge,
      positiveEdgeShadowPass,
      allReasons: ["gate disabled (kill switch)"],
      liveSideDisagrees,
    };
  }

  // ── Enforced sub-gates ──
  const sideConfidencePassed = sideConfidence >= config.min_side_confidence;
  const liveAgreementPassed = !config.require_live_side_agreement || !liveSideDisagrees;
  const positiveEdgeEnforced = config.positive_edge_mode === "enforced";
  const positiveEdgeEnforcedPassed =
    !positiveEdgeEnforced ? true : positiveEdgePassed === true;

  const allReasons: string[] = [];
  if (!sideConfidencePassed) {
    allReasons.push(
      `low side-confidence — model backs ${lockedSide} at ${(sideConfidence * 100).toFixed(0)}% (need ≥${(config.min_side_confidence * 100).toFixed(0)}%)`,
    );
  }
  if (!liveAgreementPassed) {
    allReasons.push(`live model side (${liveSide}) disagrees with locked ${lockedSide}`);
  }
  if (positiveEdgeEnforced && positiveEdgePassed !== true) {
    if (positiveEdgePassed === null) {
      allReasons.push("positive-edge enforced but selected-side ask unavailable");
    } else {
      const edgePts = (slippageAdjustedEdge ?? 0) * 100;
      allReasons.push(
        `calibrated edge ${edgePts.toFixed(2)}pts ≤ min ${config.min_calibrated_edge_points}pts (after fee + slippage)`,
      );
    }
  }

  const shouldBet = sideConfidencePassed && liveAgreementPassed && positiveEdgeEnforcedPassed;
  const primaryReason = shouldBet
    ? (() => {
        const parts = [`side-conf ${(sideConfidence * 100).toFixed(0)}%`];
        if (liveSideDisagrees) parts.push(`live-side disagrees (shadow: ${liveSide})`);
        if (positiveEdgePassed !== null) {
          const edgePts = (slippageAdjustedEdge ?? 0) * 100;
          parts.push(
            `edge ${edgePts >= 0 ? "+" : ""}${edgePts.toFixed(2)}pts (${config.positive_edge_mode})`,
          );
        }
        return `BET — ${parts.join(" · ")}`;
      })()
    : (allReasons[0] ?? "PASS");

  return {
    action: shouldBet ? "BET" : "PASS",
    reason: primaryReason,
    sideConfidence,
    liveSide,
    lockedSide,
    calibratedEdge: slippageAdjustedEdge,
    gates: {
      sideConfidencePassed,
      liveAgreementPassed,
      positiveEdgePassed,
    },
    selectedSideAsk,
    estimatedFee,
    rawModelEdge,
    feeAdjustedEdge,
    slippageAdjustedEdge,
    positiveEdgeShadowPass,
    allReasons: shouldBet ? [primaryReason] : allReasons,
    liveSideDisagrees,
  };
}
