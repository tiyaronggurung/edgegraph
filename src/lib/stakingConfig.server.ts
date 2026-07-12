// Server-only helpers for staking config. Kept out of .functions.ts because
// module-scope helpers there can be stripped by the tss-serverfn-split
// transform, causing ReferenceError at runtime for other .server.ts callers.
import { DEFAULT_LADDER_CONFIG, type LadderConfig } from "./profitBankLadder";

export const LIVE_BANK_SEED_USD = 71;
export const LIVE_BANK_CUTOFF_ISO = "2026-07-08T04:47:00Z";
export const LIVE_MAX_ENTRY_CENTS = 78;

export async function loadLadderConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<LadderConfig> {
  const { data } = await supabase
    .from("auto_odds_staking_config")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_LADDER_CONFIG };
  return {
    baseStake: Number(data.base_stake),
    unlockWins: Number(data.unlock_wins),
    profitBankStartPct: Number(data.profit_bank_start_pct),
    winGrowthPct: Number(data.win_growth_pct),
    lossReduction1Pct: Number(data.loss_reduction_1_pct),
    lossReduction2Pct: Number(data.loss_reduction_2_pct),
    maxStake: Number(data.max_stake),
    maxProfitExposurePct: Number(data.max_profit_exposure_pct),
    maxConsecutiveLosses: Number(data.max_consecutive_losses),
  };
}

export async function computeLiveLadderStake(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<{
  stake: number;
  profitBank: number;
  baseComponent: number;
  bankComponent: number;
  config: LadderConfig;
}> {
  const cfg = await loadLadderConfig(supabase, userId);
  const { data: settled } = await supabase
    .from("auto_trade_orders")
    .select("pnl_usd")
    .eq("user_id", userId)
    .eq("mode", "live")
    .in("status", ["settled_win", "settled_loss"])
    .gte("settled_at", LIVE_BANK_CUTOFF_ISO);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPnl = (settled ?? []).reduce((s: number, r: any) => s + (Number(r.pnl_usd) || 0), 0);
  const profitBank = Math.max(0, LIVE_BANK_SEED_USD + totalPnl);
  const baseComponent = cfg.baseStake * 0.25;
  const rawBankComponent = profitBank * 0.25;
  const bankCap = profitBank * cfg.maxProfitExposurePct;
  const bankComponent = Math.min(rawBankComponent, bankCap);
  const stake = Math.max(1, Math.min(cfg.maxStake, baseComponent + bankComponent));
  return {
    stake: Math.round(stake * 100) / 100,
    profitBank: Math.round(profitBank * 100) / 100,
    baseComponent: Math.round(baseComponent * 100) / 100,
    bankComponent: Math.round(bankComponent * 100) / 100,
    config: cfg,
  };
}
