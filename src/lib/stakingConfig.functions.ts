import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_LADDER_CONFIG, type LadderConfig } from "./profitBankLadder";

// Server-side helper — pulls the user's staking config (or defaults) from DB.
// Used by oddsShadowTrader; also exposed through get/set server fns for admin UI.

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
