// Server-only helpers for oddsShadowTrader server functions. Kept out of the
// .functions.ts file because module-scope declarations there are stripped by
// the tss-serverfn-split transform, causing ReferenceError at runtime.
import { replayLadder, type LadderState, type LadderConfig } from "./profitBankLadder";
import { loadLadderConfig } from "./stakingConfig.server";

export const BANK_SEED_USD = 71;
export const BANK_CUTOFF_ISO = "2026-07-08T04:47:00Z";

export async function computeLadder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<{ state: LadderState; config: LadderConfig }> {
  const config = await loadLadderConfig(supabase, userId);
  const { data: settled } = await supabase
    .from("auto_trade_orders")
    .select("pnl_usd, status, settled_at")
    .eq("user_id", userId)
    .eq("mode", "live")
    .in("status", ["settled_win", "settled_loss"])
    .gte("settled_at", BANK_CUTOFF_ISO)
    .order("settled_at", { ascending: true })
    .limit(2000);
  const orders = ((settled ?? []) as Array<{ status: string; pnl_usd: number | string }>).map(r => ({
    won: r.status === "settled_win",
    pnl_usd: Number(r.pnl_usd) || 0,
  }));
  const state = replayLadder(orders, config, BANK_SEED_USD);
  return { state, config };
}

export function aggByTrigger(rows: Array<Record<string, unknown>>, trig: string) {
  const filtered = rows.filter(r => r.trigger === trig);
  const settled = filtered.filter(r => r.settled);
  const wins = settled.filter(r => r.won);
  const pnl = settled.reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0);
  return {
    fired: filtered.length,
    settled: settled.length,
    wins: wins.length,
    pnl: Math.round(pnl * 100) / 100,
  };
}
