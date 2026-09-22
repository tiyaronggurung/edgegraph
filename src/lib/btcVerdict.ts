// 3-signal verdict rule (pure, no I/O). Shared by the read-only banner and the
// verdict bet engine so the display and the bet can never disagree.
//
// UP   = both composite avg in/out prices ABOVE the strike
//        + composite volume in > out
//        + now vs avg in positive
// DOWN = the exact mirror
// NO CALL = anything else, including the mixed case (one average each side of
//           the strike), which backtests bearish but unreliable.
//
// Backtest on logged settled windows:
//   all legs UP   -> 85.6% UP  (215 reads)
//   all legs DOWN -> 90.7% DOWN (54 reads)
//   any leg broken -> 50-57% (coin flip)

export type VerdictSide = "UP" | "DOWN" | null;

export interface VerdictInput {
  spot: number | null;
  strike: number | null;
  avgIn: number | null;
  avgOut: number | null;
  inBtc: number | null;
  outBtc: number | null;
}

export interface VerdictLegs {
  /** "UP" both averages above strike, "DOWN" both below, null mixed/unknown. */
  avgs: VerdictSide;
  /** "UP" in > out, "DOWN" out > in, null inside the dead zone. */
  flow: VerdictSide;
  /** "UP" spot above avg in, "DOWN" below. */
  nowVsAvgIn: VerdictSide;
}

export interface VerdictResult {
  legs: VerdictLegs;
  /** UP / DOWN only when all three legs agree, otherwise null (no call). */
  verdict: VerdictSide;
  /** Signed gap of spot vs the average in price, in dollars. */
  nowVsAvgInGap: number | null;
  imbalance: number | null;
}

/** Ignore a flow imbalance smaller than this (noise). */
const FLOW_DEAD_ZONE = 0.05;

export function computeVerdict(i: VerdictInput): VerdictResult {
  const { spot, strike, avgIn, avgOut, inBtc, outBtc } = i;

  let avgs: VerdictSide = null;
  if (strike != null && avgIn != null && avgOut != null) {
    if (avgIn > strike && avgOut > strike) avgs = "UP";
    else if (avgIn < strike && avgOut < strike) avgs = "DOWN";
    else avgs = null; // mixed — never a call
  }

  let flow: VerdictSide = null;
  let imbalance: number | null = null;
  if (inBtc != null && outBtc != null && inBtc + outBtc > 0) {
    imbalance = (inBtc - outBtc) / (inBtc + outBtc);
    if (imbalance > FLOW_DEAD_ZONE) flow = "UP";
    else if (imbalance < -FLOW_DEAD_ZONE) flow = "DOWN";
  }

  let nowVsAvgIn: VerdictSide = null;
  let nowVsAvgInGap: number | null = null;
  if (spot != null && avgIn != null) {
    nowVsAvgInGap = spot - avgIn;
    nowVsAvgIn = nowVsAvgInGap >= 0 ? "UP" : "DOWN";
  }

  const verdict: VerdictSide =
    avgs != null && avgs === flow && avgs === nowVsAvgIn ? avgs : null;

  return { legs: { avgs, flow, nowVsAvgIn }, verdict, nowVsAvgInGap, imbalance };
}

/** Kalshi side for a verdict: UP = YES (settles above strike). */
export function verdictToKalshiSide(v: VerdictSide): "YES" | "NO" | null {
  return v === "UP" ? "YES" : v === "DOWN" ? "NO" : null;
}
