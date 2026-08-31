// Two-Sided Hedge Engine — pure rule module.
//
// Core principle: only hold two sides when the PAIR is cheaper than the payout.
// A matched pair (1 YES + 1 NO) always settles for exactly $1.00, so a pair
// bought under 96¢ (fees + slippage included) locks profit regardless of
// outcome. A second leg is NEVER a rescue for a losing position.
//
// No I/O, no side effects, not wired into any live trading path. Both a UI
// panel and any future auto-trader must import from here so they cannot drift.

// ---------------------------------------------------------------- constants

export const HEDGE_RULES = {
  /** Max combined fee-inclusive cost of a matched pair, in cents. */
  MAX_PAIR_COST_CENTS: 96,
  /** Slippage buffer added to the opposite-side ask, in cents. */
  SLIPPAGE_CENTS: 1,
  /** Kalshi taker fee rate applied to P×(1−P) per contract, rounded up. */
  FEE_RATE: 0.0175,
  /** Absolute block: if either leg / winning side is at or above this, no opposite side. */
  DOMINANCE_BLOCK_CENTS: 70,
  /** No new entries of any kind inside T−5m. */
  MIN_SECONDS_LEFT: 300,
  /** Cumulative spend cap per side, per window (USD). */
  SIDE_CAP_USD: 300,
  /** Cumulative spend cap per window, both sides (USD). */
  WINDOW_CAP_USD: 2_000,
  /** Matched pairs: only unwind early if both legs can be sold for ≥ this. */
  PAIR_EARLY_UNWIND_CENTS: 99,
  /** Naked overhang: exit once this fraction of remaining upside is captured. */
  NAKED_EXIT_UPSIDE_RATIO: 0.92,
} as const;

export type HedgeDecision = "BUY" | "SKIP" | "BLOCK";
export type HedgeReason =
  | "inside_t5m"
  | "dominance_block"
  | "arb_test_failed"
  | "no_imbalance"
  | "cap_exhausted"
  | "ok";

// -------------------------------------------------------------------- fees

/**
 * Kalshi-style taker fee for a single contract at price `cents`, in cents,
 * rounded up (never free).
 */
export function feeCents(cents: number): number {
  const p = Math.min(Math.max(cents, 0), 100) / 100;
  return Math.ceil(HEDGE_RULES.FEE_RATE * p * (1 - p) * 100);
}

/** Fee- and slippage-inclusive effective cost of lifting the opposite ask. */
export function effectiveLegCost(askCents: number): number {
  const withSlip = askCents + HEDGE_RULES.SLIPPAGE_CENTS;
  return withSlip + feeCents(withSlip);
}

// ------------------------------------------------------------------- types

export interface HedgePosition {
  /** Side already held, e.g. "YES" | "NO". */
  sideA: string;
  sharesA: number;
  /** Fee-inclusive average cost of leg A, in cents/share. */
  avgCostA: number;
  /** Shares already held on the opposite side (0 if none). */
  sharesB?: number;
  /** Price of whichever side is currently winning, in cents. */
  dominantSidePrice?: number | null;
  /** USD already spent on the opposite side this window. */
  sideSpendUsd?: number;
  /** USD already spent this window across both sides. */
  windowSpendUsd?: number;
}

export interface HedgeMarket {
  /** Ask on the opposite side (leg B), in cents. */
  oppAskCents: number;
  secondsLeft: number;
}

export interface HedgeEvaluation {
  decision: HedgeDecision;
  reason: HedgeReason;
  /** Human-readable one-liner for the UI. */
  message: string;
  /** Opposite side to buy, when decision is BUY. */
  side: string | null;
  shares: number;
  /** Limit price in cents (fee-inclusive effective cost is `pairCostCents - avgCostA`). */
  limitPriceCents: number;
  /** Combined fee+slippage-inclusive cost of one matched pair. */
  pairCostCents: number;
  /** Locked profit per matched pair, in cents (100 − pairCost). */
  lockedProfitPerPairCents: number;
  imbalance: number;
}

const oppositeOf = (side: string) =>
  side.toUpperCase() === "YES" ? "NO" : side.toUpperCase() === "NO" ? "YES" : `NOT_${side}`;

// -------------------------------------------------------------- evaluation

export function evaluateSecondLeg(
  position: HedgePosition,
  market: HedgeMarket,
): HedgeEvaluation {
  const R = HEDGE_RULES;
  const sharesB = position.sharesB ?? 0;
  const imbalance = Math.max(0, position.sharesA - sharesB);
  const legB = effectiveLegCost(market.oppAskCents);
  const pairCost = position.avgCostA + legB;
  const side = oppositeOf(position.sideA);

  const base = {
    side: null as string | null,
    shares: 0,
    limitPriceCents: market.oppAskCents + R.SLIPPAGE_CENTS,
    pairCostCents: Number(pairCost.toFixed(2)),
    lockedProfitPerPairCents: Number((100 - pairCost).toFixed(2)),
    imbalance,
  };

  // 1. Timing — no new entries inside T−5m.
  if (!Number.isFinite(market.secondsLeft) || market.secondsLeft < R.MIN_SECONDS_LEFT) {
    return { ...base, decision: "SKIP", reason: "inside_t5m", message: "Inside T−5m — exits only, no new legs." };
  }

  // 2. Hard dominance block — absolute, no exceptions.
  const dom = Math.max(position.dominantSidePrice ?? 0, position.avgCostA);
  if (dom >= R.DOMINANCE_BLOCK_CENTS) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "dominance_block",
      message: `Dominant side at ${dom.toFixed(0)}¢ (≥${R.DOMINANCE_BLOCK_CENTS}¢) — opposite side blocked outright.`,
    };
  }

  // 3. Arb test — the only reason to open a second leg.
  if (pairCost > R.MAX_PAIR_COST_CENTS) {
    return {
      ...base,
      decision: "SKIP",
      reason: "arb_test_failed",
      message: `Pair costs ${pairCost.toFixed(1)}¢ (> ${R.MAX_PAIR_COST_CENTS}¢) — that is a new losing bet, not a hedge.`,
    };
  }

  // 4. Sizing — matched pairs only, inside the caps.
  if (imbalance <= 0) {
    return { ...base, decision: "SKIP", reason: "no_imbalance", message: "Already balanced — no matched pair to add." };
  }

  const perShareUsd = legB / 100;
  const sideRoom = Math.max(0, R.SIDE_CAP_USD - (position.sideSpendUsd ?? 0));
  const windowRoom = Math.max(0, R.WINDOW_CAP_USD - (position.windowSpendUsd ?? 0));
  const shares = Math.min(
    imbalance,
    Math.floor(sideRoom / perShareUsd),
    Math.floor(windowRoom / perShareUsd),
  );

  if (shares <= 0) {
    return { ...base, decision: "SKIP", reason: "cap_exhausted", message: "Per-side or per-window cap exhausted." };
  }

  return {
    ...base,
    decision: "BUY",
    reason: "ok",
    side,
    shares,
    message: `Buy ${shares} ${side} @ ${base.limitPriceCents}¢ — pair costs ${pairCost.toFixed(1)}¢, locks ${(100 - pairCost).toFixed(1)}¢/pair.`,
  };
}

// ------------------------------------------------------------------- exits

export interface HedgeExitInput {
  sharesA: number;
  sharesB?: number;
  /** Combined bid across both legs, in cents (matched-pair unwind price). */
  pairBidCents?: number | null;
  /** Naked overhang economics. */
  nakedStakeUsd?: number | null;
  nakedPotentialProfitUsd?: number | null;
  /** Current unrealised profit on the naked overhang, in USD. */
  nakedUnrealisedProfitUsd?: number | null;
}

export interface HedgeExitPlan {
  matchedPairs: number;
  nakedShares: number;
  /** Unwind the matched pairs early (only when combined bid ≥ 99¢). */
  unwindPairs: boolean;
  /** Exit the naked overhang now (92% of remaining upside captured). */
  exitNaked: boolean;
  upsideCapturedRatio: number | null;
  message: string;
}

export function evaluateHedgeExit(inp: HedgeExitInput): HedgeExitPlan {
  const R = HEDGE_RULES;
  const sharesB = inp.sharesB ?? 0;
  const matchedPairs = Math.min(inp.sharesA, sharesB);
  const nakedShares = Math.abs(inp.sharesA - sharesB);

  const bid = inp.pairBidCents ?? null;
  const unwindPairs = matchedPairs > 0 && bid != null && bid >= R.PAIR_EARLY_UNWIND_CENTS;

  const pot = inp.nakedPotentialProfitUsd ?? null;
  const now = inp.nakedUnrealisedProfitUsd ?? null;
  const ratio = pot != null && pot > 0 && now != null ? now / pot : null;
  const exitNaked = nakedShares > 0 && ratio != null && ratio >= R.NAKED_EXIT_UPSIDE_RATIO;

  const parts: string[] = [];
  if (matchedPairs > 0) {
    parts.push(
      unwindPairs
        ? `Unwind ${matchedPairs} pair(s) at ${bid}¢ — beats waiting for settlement.`
        : `Hold ${matchedPairs} matched pair(s) to settlement — profit already locked.`,
    );
  }
  if (nakedShares > 0) {
    parts.push(
      exitNaked
        ? `Exit ${nakedShares} naked share(s) now — ${((ratio ?? 0) * 100).toFixed(0)}% of upside captured.`
        : ratio != null
          ? `Hold naked overhang — ${(ratio * 100).toFixed(0)}% of upside captured (need ${(R.NAKED_EXIT_UPSIDE_RATIO * 100).toFixed(0)}%).`
          : "Naked overhang — upside unknown, normal exit rules apply.",
    );
  }

  return {
    matchedPairs,
    nakedShares,
    unwindPairs,
    exitNaked,
    upsideCapturedRatio: ratio,
    message: parts.join(" ") || "No position.",
  };
}
