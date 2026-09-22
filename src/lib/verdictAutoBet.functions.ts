// Auth'd server fns for the Verdict Auto-Bet panel (real money only).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getVerdictBetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("profiles")
      .select(
        "verdict_bet_enabled, verdict_bet_live_enabled, verdict_bet_stake_cents, kalshi_api_key_id, kalshi_private_key_pem",
      )
      .eq("id", userId)
      .maybeSingle();
    return {
      enabled: !!data?.verdict_bet_enabled,
      live: !!data?.verdict_bet_live_enabled,
      hasKeys: !!(data?.kalshi_api_key_id && data?.kalshi_private_key_pem),
      stakeCents: Math.max(100, Math.min(10000, Number(data?.verdict_bet_stake_cents) || 1000)),
    };
  });

export const setVerdictBetEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("profiles")
      .update({
        verdict_bet_enabled: data.enabled,
        verdict_bet_enabled_at: data.enabled ? new Date().toISOString() : null,
      } as never)
      .eq("id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, enabled: data.enabled };
  });

export const setVerdictBetLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ live: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (data.live) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("kalshi_api_key_id, kalshi_private_key_pem")
        .eq("id", userId)
        .maybeSingle();
      if (!prof?.kalshi_api_key_id || !prof?.kalshi_private_key_pem) {
        return { ok: false as const, error: "Add your Kalshi keys in Settings before turning on real money." };
      }
    }
    const { error } = await supabase
      .from("profiles")
      .update({ verdict_bet_live_enabled: data.live } as never)
      .eq("id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, live: data.live };
  });

export const getVerdictBetTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("crypto_trades")
      .select("id,ticker,close_time,side,contracts,stake_usd,status,pnl_usd,created_at,inputs_snapshot")
      .eq("user_id", userId)
      .filter("inputs_snapshot->>source", "eq", "verdict_bet")
      .order("created_at", { ascending: false })
      .limit(40);
    const rows = ((data ?? []) as any[]).map((r) => ({
      id: r.id as string,
      ticker: r.ticker as string,
      side: r.side as "YES" | "NO",
      contracts: (r.contracts ?? 0) as number,
      askCents: Number(r.inputs_snapshot?.ask_cents) || 0,
      stakeUsd: Number(r.stake_usd ?? 0),
      pnlUsd: r.pnl_usd == null ? null : Number(r.pnl_usd),
      createdAt: r.created_at as string,
    }));
    const settled = rows.filter((r) => r.pnlUsd != null);
    return {
      rows,
      fires: rows.length,
      wins: settled.filter((r) => (r.pnlUsd ?? 0) > 0).length,
      losses: settled.filter((r) => (r.pnlUsd ?? 0) <= 0).length,
      pnlUsd: settled.reduce((s, r) => s + (r.pnlUsd ?? 0), 0),
    };
  });
