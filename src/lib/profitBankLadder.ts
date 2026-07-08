// Profit Bank Ladder — deterministic staking engine.
// Replays a chronological stream of settled LIVE Kalshi orders and derives
// the next stake plus current ladder state. Base bankroll is never touched:
// only the profit bank (seed + realized PnL) funds Profit Mode.

export interface LadderConfig {
  baseStake: number;
  unlockWins: number;
  profitBankStartPct: number;   // e.g. 0.25
  winGrowthPct: number;         // e.g. 0.10
  lossReduction1Pct: number;    // e.g. 0.30 → stake *= 0.70
  lossReduction2Pct: number;    // e.g. 0.50 → stake *= 0.50
  maxStake: number;             // hard cap
  maxProfitExposurePct: number; // e.g. 0.40
  maxConsecutiveLosses: number; // e.g. 3
}

export const DEFAULT_LADDER_CONFIG: LadderConfig = {
  baseStake: 100,
  unlockWins: 3,
  profitBankStartPct: 0.25,
  winGrowthPct: 0.10,
  lossReduction1Pct: 0.30,
  lossReduction2Pct: 0.50,
  maxStake: 150,
  maxProfitExposurePct: 0.40,
  maxConsecutiveLosses: 3,
};

export interface LadderOrder {
  won: boolean;
  pnl_usd: number;
}

export interface LadderState {
  profitBank: number;
  profitBankMode: boolean;
  nextStake: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  highestProfitBank: number;
  currentLadderLevel: number;
}

function clampProfitStake(s: number, bank: number, cfg: LadderConfig): number {
  const capped = Math.min(s, bank * cfg.maxProfitExposurePct, cfg.maxStake);
  return Math.max(1, capped);
}

/**
 * Replay chronologically-ordered settled orders and return the final ladder
 * state. `seed` is the starting profit bank at time 0 (e.g. carryover
 * before the cutoff).
 */
export function replayLadder(
  orders: LadderOrder[],
  cfg: LadderConfig,
  seed: number,
): LadderState {
  let profitBank = Math.max(0, seed);
  let mode = false;
  let stake = cfg.baseStake;
  let wins = 0;
  let losses = 0;
  let highest = profitBank;
  let level = 0;

  for (const o of orders) {
    const pnl = Number(o.pnl_usd) || 0;
    profitBank = Math.max(0, profitBank + pnl);
    highest = Math.max(highest, profitBank);

    if (o.won) {
      wins++;
      losses = 0;
      if (!mode) {
        if (wins >= cfg.unlockWins && profitBank > 0) {
          mode = true;
          level = 1;
          stake = clampProfitStake(profitBank * cfg.profitBankStartPct, profitBank, cfg);
        } else {
          stake = cfg.baseStake;
        }
      } else {
        level++;
        stake = clampProfitStake(stake * (1 + cfg.winGrowthPct), profitBank, cfg);
      }
    } else {
      losses++;
      wins = 0;
      if (mode) {
        if (profitBank <= 0 || losses >= cfg.maxConsecutiveLosses) {
          // Exit profit mode → back to base, reset ladder counters.
          mode = false;
          stake = cfg.baseStake;
          level = 0;
          losses = 0;
        } else if (losses === 1) {
          stake = clampProfitStake(stake * (1 - cfg.lossReduction1Pct), profitBank, cfg);
        } else if (losses === 2) {
          stake = clampProfitStake(stake * (1 - cfg.lossReduction2Pct), profitBank, cfg);
        }
      } else {
        stake = cfg.baseStake;
      }
    }
  }

  // Final hard-cap sweep for next stake.
  const nextStake = mode && profitBank > 0
    ? clampProfitStake(stake, profitBank, cfg)
    : cfg.baseStake;

  return {
    profitBank: Math.round(profitBank * 100) / 100,
    profitBankMode: mode,
    nextStake: Math.round(nextStake * 100) / 100,
    consecutiveWins: wins,
    consecutiveLosses: losses,
    highestProfitBank: Math.round(highest * 100) / 100,
    currentLadderLevel: level,
  };
}
