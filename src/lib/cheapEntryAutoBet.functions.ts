// Auth'd server fns for the Cheap Entry Auto-Bet (paper) panel.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface CheapEntryFill {
  id: string;
  ticker: string;
  close_time: string;
  side: "YES" | "NO";
  contracts: number;
  fill_price_cents: number;
  stake_cents: number;
  status: "open" | "won" | "lost" | "void";
  pnl_cents: number | null;
  created_at: string;
  pick_source: "study" | "model" | null;
}

export const getCheapEntrySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("profiles")
      .select("cheap_entry_enabled, cheap_entry_stake_cents")
      .eq("id", userId)
      .maybeSingle();
    return {
      enabled: !!data?.cheap_entry_enabled,
      stakeCents: Math.max(100, Math.min(10000, Number(data?.cheap_entry_stake_cents) || 1000)),
    };
  });

export const setCheapEntryEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("profiles")
      .update({
        cheap_entry_enabled: data.enabled,
        // Arming stamps the moment it was switched on so the engine only
        // touches windows that START after this — never the one running now.
        cheap_entry_enabled_at: data.enabled ? new Date().toISOString() : null,
      } as never)
      .eq("id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, enabled: data.enabled };
  });

export const setCheapEntryStake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ stakeCents: z.number().int().min(100).max(10000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("profiles")
      .update({ cheap_entry_stake_cents: data.stakeCents } as never)
      .eq("id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, stakeCents: data.stakeCents };
  });

export const getCheapEntryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("paper_fills")
      .select("id,ticker,close_time,side,contracts,fill_price_cents,stake_cents,status,pnl_cents,created_at,entry_snapshot")
      .eq("user_id", userId)
      .filter("entry_snapshot->>source", "eq", "cheap_entry")
      .order("created_at", { ascending: false })
      .limit(60);

    const rows = ((data ?? []) as any[]).map((r): CheapEntryFill => ({
      id: r.id,
      ticker: r.ticker,
      close_time: r.close_time,
      side: r.side,
      contracts: r.contracts,
      fill_price_cents: r.fill_price_cents,
      stake_cents: r.stake_cents,
      status: r.status,
      pnl_cents: r.pnl_cents,
      created_at: r.created_at,
      pick_source: (r.entry_snapshot?.pick_source as "study" | "model" | undefined) ?? null,
    }));

    const tally = (list: CheapEntryFill[]) => ({
      fires: list.length,
      wins: list.filter((f) => f.status === "won").length,
      losses: list.filter((f) => f.status === "lost").length,
      open: list.filter((f) => f.status === "open").length,
      pnlCents: list.reduce((s, f) => s + (f.pnl_cents ?? 0), 0),
      avgEntryCents: list.length
        ? Math.round(list.reduce((s, f) => s + f.fill_price_cents, 0) / list.length)
        : 0,
    });

    return {
      rows,
      total: tally(rows),
      study: tally(rows.filter((r) => r.pick_source === "study")),
      model: tally(rows.filter((r) => r.pick_source === "model")),
    };
  });

// Recent skip reasons, so the panel can show why a window didn't qualify.
export const getCheapEntrySkips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("auto_trade_skip_log")
      .select("id, ticker, side, ask_price, seconds_to_close, skip_reason, created_at")
      .eq("user_id", userId)
      .like("skip_reason", "cheap_entry:%")
      .order("created_at", { ascending: false })
      .limit(12);
    return { skips: (data ?? []) as any[] };
  });
