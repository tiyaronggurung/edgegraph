import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type LadderConfig } from "./profitBankLadder";
import { loadLadderConfig } from "./stakingConfig.server";

// Re-export server-only helpers/constants so any existing importers keep
// working. Runtime bodies live in stakingConfig.server.ts to stay out of
// the tss-serverfn-split transform.
export {
  loadLadderConfig,
  computeLiveLadderStake,
  LIVE_BANK_SEED_USD,
  LIVE_BANK_CUTOFF_ISO,
  LIVE_MAX_ENTRY_CENTS,
} from "./stakingConfig.server";

export const getStakingConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await loadLadderConfig(context.supabase, context.userId);
    return { ok: true as const, config: cfg };
  });

export const updateStakingConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<LadderConfig>) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row: Record<string, number> = {};
    if (data.baseStake !== undefined) row.base_stake = Number(data.baseStake);
    if (data.unlockWins !== undefined) row.unlock_wins = Number(data.unlockWins);
    if (data.profitBankStartPct !== undefined) row.profit_bank_start_pct = Number(data.profitBankStartPct);
    if (data.winGrowthPct !== undefined) row.win_growth_pct = Number(data.winGrowthPct);
    if (data.lossReduction1Pct !== undefined) row.loss_reduction_1_pct = Number(data.lossReduction1Pct);
    if (data.lossReduction2Pct !== undefined) row.loss_reduction_2_pct = Number(data.lossReduction2Pct);
    if (data.maxStake !== undefined) row.max_stake = Number(data.maxStake);
    if (data.maxProfitExposurePct !== undefined) row.max_profit_exposure_pct = Number(data.maxProfitExposurePct);
    if (data.maxConsecutiveLosses !== undefined) row.max_consecutive_losses = Number(data.maxConsecutiveLosses);
    const { error } = await supabase
      .from("auto_odds_staking_config")
      .upsert({ user_id: userId, ...row }, { onConflict: "user_id" });
    if (error) return { ok: false as const, error: error.message };
    const cfg = await loadLadderConfig(supabase, userId);
    return { ok: true as const, config: cfg };
  });
