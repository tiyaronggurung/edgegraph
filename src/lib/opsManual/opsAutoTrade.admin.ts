// Admin-side helpers for the Ops Manual auto-trader. Server-only.
import { runOpsAutoTradeForUser, loadOpsSessionState } from "./opsAutoTrade.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function assertAdmin(supabase: SB, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("is_ops_admin", { _user_id: userId });
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden");
}

export async function getOpsAutoStatus(supabase: SB, userId: string) {
  await assertAdmin(supabase, userId);
  const { data: profile } = await supabase
    .from("profiles")
    .select("ops_auto_trade_enabled, kalshi_api_key_id, kalshi_private_key_pem")
    .eq("id", userId)
    .maybeSingle();

  const s = await loadOpsSessionState(supabase, userId);
  const { data: recent } = await supabase
    .from("ops_trades")
    .select("id, ticker, side, stake, ask_cents, contracts, result, realized_pnl, decision_at")
    .eq("user_id", userId)
    .eq("source", "ops_auto")
    .order("decision_at", { ascending: false })
    .limit(20);

  return {
    enabled: !!profile?.ops_auto_trade_enabled,
    hasKeys: !!(profile?.kalshi_api_key_id && profile?.kalshi_private_key_pem),
    dayOpened: s.dayOpened,
    morningBankroll: s.morningBankroll,
    unitUsd: s.staking.mode === "disabled" ? 0 : s.staking.unitUsd,
    stakingMode: s.staking.mode,
    stakingReason: s.staking.reason,
    status: s.status.status,
    stopped: s.stops.stopped,
    stopReason: s.stops.reason,
    betsRemaining: s.stops.betsRemaining,
    dailyPnl: s.dailyPnl,
    consecutiveLosses: s.consec,
    autoTrades: recent ?? [],
  };
}

export async function setOpsAutoEnabled(supabase: SB, userId: string, enabled: boolean) {
  await assertAdmin(supabase, userId);
  const { error } = await supabase.from("profiles").update({ ops_auto_trade_enabled: enabled }).eq("id", userId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, enabled };
}

export async function previewOpsAuto(supabase: SB, userId: string) {
  await assertAdmin(supabase, userId);
  return await runOpsAutoTradeForUser(userId, { dryRun: true });
}
