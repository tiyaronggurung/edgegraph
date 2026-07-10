// Pure math for Martingale Recovery (Option D: partial recovery across 3 wins).
// No I/O — safe to import anywhere.

export interface RecoveryState {
  enabled: boolean;
  deficit_usd: number;
  initial_deficit_usd: number;
  recovery_wins_completed: number;
  consec_recovery_losses: number;
  session_loss_usd: number;
  session_started_at: string;
  stopped_reason: string | null;
  base_stake_usd: number;
  max_stake_usd: number;
  accepted_deficit_usd: number;
  session_loss_cap_usd: number;
  max_consec_recovery_losses: number;
}

export interface StakePlan {
  contracts: number;
  stakeUsd: number;
  limitCents: number;
  targetProfitUsd: number;
  expectedProfitUsd: number;
  inRecovery: boolean;
  winsRemaining: number;
}

/**
 * Compute stake for the NEXT ticket given current recovery state and favored-side price.
 * Returns null when: price out of range, no contracts affordable within max stake, or stopped.
 */
export function planStake(
  state: RecoveryState,
  favoredCents: number,
): StakePlan | null {
  if (!state.enabled || state.stopped_reason) return null;
  if (favoredCents < 70 || favoredCents > 80) return null;

  const inRecovery = state.deficit_usd > state.accepted_deficit_usd;
  const p = favoredCents / 100;
  const profitPerContract = (100 - favoredCents) / 100; // $ won per contract if right

  let stakeUsd: number;
  let targetProfit: number;
  let winsRemaining = 3;

  if (!inRecovery) {
    stakeUsd = state.base_stake_usd;
    targetProfit = stakeUsd * profitPerContract / p; // profit at that stake
  } else {
    winsRemaining = Math.max(1, 3 - state.recovery_wins_completed);
    targetProfit = (state.deficit_usd - state.accepted_deficit_usd) / winsRemaining;
    // contracts to hit target profit; each contract wins profitPerContract
    const contractsRaw = targetProfit / profitPerContract;
    stakeUsd = Math.ceil(contractsRaw) * favoredCents / 100;
    if (stakeUsd > state.max_stake_usd) stakeUsd = state.max_stake_usd;
  }

  const contracts = Math.floor((stakeUsd * 100) / favoredCents);
  if (contracts < 1) return null;
  const realStake = (contracts * favoredCents) / 100;
  const expectedProfit = contracts * profitPerContract;

  return {
    contracts,
    stakeUsd: realStake,
    limitCents: favoredCents,
    targetProfitUsd: targetProfit,
    expectedProfitUsd: expectedProfit,
    inRecovery,
    winsRemaining,
  };
}

/**
 * Apply a settled trade result and return next state.
 * pnl_usd is realized profit (positive) or loss (negative, e.g. -50 for a $50 loss).
 */
export function applySettlement(state: RecoveryState, pnlUsd: number): RecoveryState {
  const s = { ...state };
  const wasInRecovery = s.deficit_usd > s.accepted_deficit_usd;

  if (pnlUsd >= 0) {
    // Win
    if (wasInRecovery) {
      s.deficit_usd = Math.max(0, s.deficit_usd - pnlUsd);
      s.recovery_wins_completed += 1;
      s.consec_recovery_losses = 0;
      if (
        s.deficit_usd <= s.accepted_deficit_usd ||
        s.recovery_wins_completed >= 3
      ) {
        s.deficit_usd = 0;
        s.initial_deficit_usd = 0;
        s.recovery_wins_completed = 0;
      }
    }
    // wins outside recovery: nothing to track (banked externally)
  } else {
    const loss = Math.abs(pnlUsd);
    s.session_loss_usd += loss;
    s.deficit_usd += loss;
    if (wasInRecovery) {
      s.consec_recovery_losses += 1;
    } else {
      s.consec_recovery_losses = 0;
    }
    // Just entered recovery: record initial deficit
    if (!wasInRecovery && s.deficit_usd > s.accepted_deficit_usd) {
      s.initial_deficit_usd = s.deficit_usd;
      s.recovery_wins_completed = 0;
    }
  }

  // Stop conditions
  if (s.session_loss_usd >= s.session_loss_cap_usd) {
    s.stopped_reason = "session_loss_cap";
    s.enabled = false;
  } else if (s.consec_recovery_losses >= s.max_consec_recovery_losses) {
    s.stopped_reason = "consec_recovery_losses";
    s.enabled = false;
  }
  return s;
}

/**
 * Reset session counters (called on new UTC day or manual reset).
 * Preserves enabled flag and deficit (deficit carries across sessions until recovered).
 */
export function resetSession(state: RecoveryState): RecoveryState {
  return {
    ...state,
    session_loss_usd: 0,
    consec_recovery_losses: 0,
    session_started_at: new Date().toISOString(),
    stopped_reason: null,
  };
}

export function isNewUtcDay(sessionStartedAt: string): boolean {
  const then = new Date(sessionStartedAt);
  const now = new Date();
  return (
    then.getUTCFullYear() !== now.getUTCFullYear() ||
    then.getUTCMonth() !== now.getUTCMonth() ||
    then.getUTCDate() !== now.getUTCDate()
  );
}
