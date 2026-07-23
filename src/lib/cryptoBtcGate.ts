// Pure helpers extracted from cryptoBtc.functions.ts so the decision logic is
// independently unit-testable. Both call sites MUST stay in sync — these
// functions are the authoritative implementation; the server fn imports them.

export interface GateMicroSubset {
  cvdRatio?: number;
  ofi?: number;
}

export interface GapAnalysis {
  gapUsd: number;
  gapPct: number;
  needsToMoveUsd: number;
  needsDirection: "up" | "down" | "hold";
  expectedMoveUsd: number;
  gapInSigmas: number;
  momentumSign: -1 | 0 | 1;
  momentumAlignsWithSide: boolean;
  verdict: string;
}

/**
 * Anchors every verdict in strike↔spot geometry.
 * sigmaEff is per-minute σ in % terms (e.g. 0.15 = 0.15% per minute).
 */
export function computeGapAnalysis(args: {
  spot: number;
  strike: number;
  side: "YES" | "NO";
  sigmaEff: number;
  secondsToClose: number;
  micro: GateMicroSubset | null;
}): GapAnalysis {
  const { spot, strike, side, sigmaEff, secondsToClose, micro } = args;
  const sideWantsAbove = side === "YES";
  const currentlyWinning = sideWantsAbove ? (spot >= strike) : (spot <= strike);
  const needsToMoveUsd = currentlyWinning ? 0 : (strike - spot);
  const expectedMoveUsd = (sigmaEff / 100) * Math.sqrt(Math.max(secondsToClose, 1) / 60) * spot;
  const gapInSigmasRaw = expectedMoveUsd > 0 ? Math.abs(needsToMoveUsd) / expectedMoveUsd : 99;
  const momentumBlend = ((micro?.cvdRatio ?? 0) + (micro?.ofi ?? 0)) / 2;
  const momentumSign: -1 | 0 | 1 = momentumBlend > 0.05 ? 1 : momentumBlend < -0.05 ? -1 : 0;
  const momentumAlignsWithSide = momentumSign === 0
    ? true
    : (sideWantsAbove ? momentumSign > 0 : momentumSign < 0);
  const verdict = currentlyWinning
    ? `spot ${sideWantsAbove ? "above" : "below"} strike by $${Math.abs(spot - strike).toFixed(0)} — ${side} defends · ${expectedMoveUsd.toFixed(0)}$/σ remaining · momentum ${momentumBlend >= 0 ? "+" : ""}${momentumBlend.toFixed(2)} ${momentumAlignsWithSide ? "holds" : "threatens"}`
    : `spot must move ${sideWantsAbove ? "+" : "−"}$${Math.abs(needsToMoveUsd).toFixed(0)} in ${secondsToClose}s (${gapInSigmasRaw.toFixed(2)}σ) · momentum ${momentumBlend >= 0 ? "+" : ""}${momentumBlend.toFixed(2)} ${momentumAlignsWithSide ? "helps" : "fights"} ${side}`;
  return {
    gapUsd: spot - strike,
    gapPct: ((spot - strike) / spot) * 100,
    needsToMoveUsd,
    needsDirection: currentlyWinning ? "hold" : (sideWantsAbove ? "up" : "down"),
    expectedMoveUsd,
    gapInSigmas: currentlyWinning ? 0 : gapInSigmasRaw,
    momentumSign,
    momentumAlignsWithSide,
    verdict,
  };
}

/**
 * Time-scaled pin-risk floor in σ. Tightens as the clock runs down — Kalshi
 * pins ATM strikes by design, so our edge cannot survive the last minute.
 */
export function pinRiskFloorSigmas(secondsToClose: number): number {
  if (secondsToClose <= 90) return 1.5;
  if (secondsToClose <= 180) return 1.0;
  return 0.5;
}

export interface GateInput {
  side: "YES" | "NO";
  secondsToClose: number;
  yesPrice: number;
  sigDist: number;
  edgeAbs: number;
  requiredEdgePts: number;
  kelly: number;
  gap: GapAnalysis;
  // Chosen-side confidence = side==="YES" ? modelYesProb : 1 - modelYesProb.
  // Measures how strongly the current model still backs the LOCKED side. On
  // 1,330 settled rows the <0.45 bucket hit only 9.4% (locked side had
  // diverged from the model's current directional lean). Optional — undefined
  // preserves legacy behavior so unit tests and old call sites keep working.
  sideConf?: number;
  // True when the live per-tick directional call disagrees with the locked
  // side. Same 9.4% loser bucket — the model wants to flip but can't.
  liveFlipped?: boolean;
  // Optional geometry for the near-strike deadband. When spot is within
  // NEAR_STRIKE_DEADBAND_PCT of strike AND <60s remain, we skip — this
  // kills the 17% `near_strike_flip` autopsy bucket (last-minute chop).
  spot?: number;
  strike?: number;
  // Count of consecutive settled losses immediately preceding this snapshot,
  // fed by the snapshot loop. 48h data (n=178) shows WR drops from 50%
  // baseline to 41% after 2 straight losses; 3+ streaks stay depressed.
  // Optional so unit tests and old call sites still work.
  lossStreak?: number;
}




export interface GateResult {
  gateAction: "BET" | "PASS";
  gateReason: string;
}

// Minimum chosen-side confidence for the edge gate to fire. 0.90 matches
// the settled-sample study where side_conf >= 0.90 hits ~94%; lower
// thresholds mix in the low-conviction band that history says loses.
export const MIN_SIDE_CONF = 0.90;

// Near-strike deadband: when |spot − strike| / strike is under this and less
// than NEAR_STRIKE_DEADBAND_SECS remain, we skip. Loss autopsy showed 17% of
// losses cluster here as pure last-minute chop that no side-signal can rescue.
export const NEAR_STRIKE_DEADBAND_PCT = 0.03; // percent, i.e. 0.03%
export const NEAR_STRIKE_DEADBAND_SECS = 60;

export function evaluateGate(input: GateInput): GateResult {
  const { side, secondsToClose, yesPrice, sigDist, edgeAbs, requiredEdgePts, kelly, gap, sideConf, liveFlipped, spot, strike } = input;
  const pinRiskFloor = pinRiskFloorSigmas(secondsToClose);
  const currentlyWinning = gap.needsDirection === "hold";

  if (secondsToClose <= 30) {
    return { gateAction: "PASS", gateReason: "too close to expiry (<30s) — slippage risk" };
  }
  if (yesPrice <= 0.02 || yesPrice >= 0.98) {
    return { gateAction: "PASS", gateReason: "price pinned (≤2¢ or ≥98¢) — no room for edge" };
  }
  // Near-strike deadband — kills the 17% `near_strike_flip` autopsy bucket.
  if (spot !== undefined && strike !== undefined && strike > 0 && secondsToClose < NEAR_STRIKE_DEADBAND_SECS) {
    const distPct = Math.abs(spot - strike) / strike * 100;
    if (distPct < NEAR_STRIKE_DEADBAND_PCT) {
      return {
        gateAction: "PASS",
        gateReason: `near-strike deadband — spot ${distPct.toFixed(3)}% from strike with ${secondsToClose}s left (chop zone)`,
      };
    }
  }

  // Side-confidence gate: blocks the "locked-side diverged from model"
  // bucket (~9% historical hit rate). Skipped when caller omits sideConf.
  if (sideConf !== undefined && sideConf < MIN_SIDE_CONF) {
    return {
      gateAction: "PASS",
      gateReason: `low side-confidence — model backs ${side} at ${(sideConf * 100).toFixed(0)}% (need ≥${(MIN_SIDE_CONF * 100).toFixed(0)}%)`,
    };
  }
  // Live-flip gate: skip when the per-tick direction opposes the locked side.
  if (liveFlipped) {
    return {
      gateAction: "PASS",
      gateReason: `live model has flipped away from locked ${side} — skip`,
    };
  }
  if (sigDist < pinRiskFloor && secondsToClose > 60) {
    return {
      gateAction: "PASS",
      gateReason: `coin-flip zone — strike only ${sigDist.toFixed(2)}σ from spot (floor ${pinRiskFloor.toFixed(1)}σ at ${secondsToClose}s)`,
    };
  }
  if (!currentlyWinning && gap.gapInSigmas > 1.0 && !gap.momentumAlignsWithSide) {
    return {
      gateAction: "PASS",
      gateReason: `traversal block — ${side} needs ${gap.gapInSigmas.toFixed(2)}σ move but momentum fights`,
    };
  }
  if (!currentlyWinning && gap.gapInSigmas > 1.5) {
    return {
      gateAction: "PASS",
      gateReason: `gap too wide — ${side} needs ${gap.gapInSigmas.toFixed(2)}σ traversal in ${secondsToClose}s`,
    };
  }
  if (edgeAbs < requiredEdgePts) {
    return {
      gateAction: "PASS",
      gateReason: `edge ${edgeAbs.toFixed(1)}pts < required ${requiredEdgePts.toFixed(1)}pts`,
    };
  }
  if (kelly <= 0) {
    return { gateAction: "PASS", gateReason: "Kelly fraction ≤ 0" };
  }
  const confNote = sideConf !== undefined ? ` · sideConf ${(sideConf * 100).toFixed(0)}%` : "";
  return {
    gateAction: "BET",
    gateReason: `edge ${edgeAbs.toFixed(1)}pts ≥ required ${requiredEdgePts.toFixed(1)}pts · safety ${sigDist.toFixed(2)}σ${confNote} · ${gap.verdict}`,
  };
}

export interface RequiredEdgeMicro {
  bookSpreadBps?: number;
  fundingRate?: number;
  basisBps?: number;
  whaleImbalance1m?: number;
  whaleBuyUsd1m?: number;
  whaleSellUsd1m?: number;
}

export function computeRequiredEdgePts(args: {
  side: "YES" | "NO";
  secondsToClose: number;
  micro: RequiredEdgeMicro | null;
  calibBrier: number | null; // null = cold start
  calibN: number;            // sample count in current bucket
}): { requiredEdgePts: number; parts: { base: number; calib: number; time: number; spread: number; regime: number; whale: number } } {
  const { side, secondsToClose, micro, calibBrier, calibN } = args;
  const tBase = 3;
  const tCalib = calibBrier !== null && calibN >= 30
    ? Math.max(0, Math.min(4, (calibBrier - 0.20) * 30))
    : 0.5;
  const tTime = secondsToClose < 60 ? 2 : secondsToClose < 300 ? 1 : 0;
  const sp = micro?.bookSpreadBps ?? 0;
  const tSpread = sp > 10 ? 2 : sp > 5 ? 1 : 0;
  const fundAbs = Math.abs(micro?.fundingRate ?? 0) / 0.00005;
  const basisAbs = Math.abs(micro?.basisBps ?? 0) / 5;
  const tRegime = (fundAbs > 2 || basisAbs > 2) ? 1.5 : 0;
  const wImb = micro?.whaleImbalance1m ?? 0;
  const sideSign = side === "YES" ? 1 : -1;
  let tWhale = 0;
  if (Math.abs(wImb) > 0.6 && (micro?.whaleBuyUsd1m ?? 0) + (micro?.whaleSellUsd1m ?? 0) > 500_000) {
    tWhale = Math.sign(wImb) === sideSign ? -1.0 : 1.5;
  }
  const requiredEdgePts = Math.max(1.5, tBase + tCalib + tTime + tSpread + tRegime + tWhale);
  return { requiredEdgePts, parts: { base: tBase, calib: tCalib, time: tTime, spread: tSpread, regime: tRegime, whale: tWhale } };
}
