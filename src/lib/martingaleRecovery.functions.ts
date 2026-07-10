import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resetSession, type RecoveryState } from "./martingaleRecovery";

type StateRow = RecoveryState & {
  user_id: string;
  last_shadow_id: string | null;
  updated_at: string;
};

async function loadOrInit(supabase: ReturnType<typeof getSb>, userId: string): Promise<StateRow> {
  const { data } = await supabase
    .from("martingale_recovery_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as StateRow;
  const seed = {
    user_id: userId,
    enabled: false,
    deficit_usd: 0,
    initial_deficit_usd: 0,
    recovery_wins_completed: 0,
    consec_recovery_losses: 0,
    session_loss_usd: 0,
    session_started_at: new Date().toISOString(),
    stopped_reason: null,
    last_shadow_id: null,
    base_stake_usd: 50,
    max_stake_usd: 150,
    accepted_deficit_usd: 15,
    session_loss_cap_usd: 200,
    max_consec_recovery_losses: 2,
  };
  const { data: ins } = await supabase
    .from("martingale_recovery_state")
    .insert(seed)
    .select("*")
    .single();
  return ins as StateRow;
}

// Trick: reuse the caller-scoped client's exact type. Not exported.
function getSb() {
  // placeholder for TS type inference
  return null as unknown as import("@supabase/supabase-js").SupabaseClient;
}

export const getRecoveryState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    return loadOrInit(supabase as ReturnType<typeof getSb>, userId);
  });

export const setRecoveryEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const cur = await loadOrInit(supabase as ReturnType<typeof getSb>, userId);
    const patch = data.enabled
      ? { enabled: true, stopped_reason: null }
      : { enabled: false };
    const { data: upd } = await supabase
      .from("martingale_recovery_state")
      .update(patch)
      .eq("user_id", userId)
      .select("*")
      .single();
    return (upd ?? cur) as StateRow;
  });

export const resetRecoverySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const cur = await loadOrInit(supabase as ReturnType<typeof getSb>, userId);
    const next = resetSession(cur);
    const { data: upd } = await supabase
      .from("martingale_recovery_state")
      .update({
        session_loss_usd: next.session_loss_usd,
        consec_recovery_losses: next.consec_recovery_losses,
        session_started_at: next.session_started_at,
        stopped_reason: next.stopped_reason,
      })
      .eq("user_id", userId)
      .select("*")
      .single();
    return (upd ?? cur) as StateRow;
  });

export const clearRecoveryDeficit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: upd } = await supabase
      .from("martingale_recovery_state")
      .update({
        deficit_usd: 0,
        initial_deficit_usd: 0,
        recovery_wins_completed: 0,
      })
      .eq("user_id", userId)
      .select("*")
      .single();
    return upd as StateRow;
  });
