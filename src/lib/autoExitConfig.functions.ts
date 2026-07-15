import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AutoExitConfig = {
  exit_tp_frac: number;
  exit_sl_frac: number;
  exit_late_sl_frac: number;
  exit_edge_decay_cents: number;
  exit_flip_prob: number;
  exit_odds_flip_cents: number;
};

export const DEFAULT_AUTO_EXIT_CONFIG: AutoExitConfig = {
  exit_tp_frac: 0.80,
  exit_sl_frac: 0.75,
  exit_late_sl_frac: 0.25,
  exit_edge_decay_cents: 2,
  exit_flip_prob: 0.45,
  exit_odds_flip_cents: 12,
};

export const getAutoExitConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutoExitConfig> => {
    const { data } = await context.supabase
      .from("auto_odds_settings")
      .select("exit_tp_frac, exit_sl_frac, exit_late_sl_frac, exit_edge_decay_cents, exit_flip_prob, exit_odds_flip_cents")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      exit_tp_frac: Number(data?.exit_tp_frac ?? DEFAULT_AUTO_EXIT_CONFIG.exit_tp_frac),
      exit_sl_frac: Number(data?.exit_sl_frac ?? DEFAULT_AUTO_EXIT_CONFIG.exit_sl_frac),
      exit_late_sl_frac: Number(data?.exit_late_sl_frac ?? DEFAULT_AUTO_EXIT_CONFIG.exit_late_sl_frac),
      exit_edge_decay_cents: Number(data?.exit_edge_decay_cents ?? DEFAULT_AUTO_EXIT_CONFIG.exit_edge_decay_cents),
      exit_flip_prob: Number(data?.exit_flip_prob ?? DEFAULT_AUTO_EXIT_CONFIG.exit_flip_prob),
      exit_odds_flip_cents: Number(data?.exit_odds_flip_cents ?? DEFAULT_AUTO_EXIT_CONFIG.exit_odds_flip_cents),
    };
  });

const UpdateSchema = z.object({
  exit_tp_frac: z.number().min(0.05).max(5),
  exit_sl_frac: z.number().min(0.05).max(1),
  exit_late_sl_frac: z.number().min(0.05).max(1),
  exit_edge_decay_cents: z.number().int().min(1).max(50),
  exit_flip_prob: z.number().min(0).max(1),
  exit_odds_flip_cents: z.number().int().min(1).max(50),
});

export const updateAutoExitConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("auto_odds_settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
