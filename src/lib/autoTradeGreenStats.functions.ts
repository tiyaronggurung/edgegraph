// Live auto-trade green-hour stats since a fresh cutoff.
// Reads ONLY from auto_trade_orders (mode=live, settled) — the real fires,
// not raw model predictions.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Fresh start requested by the user — count only fires from this date onward.
export const AUTO_TRADE_GREEN_STATS_CUTOFF_ISO = "2026-07-21T00:00:00Z";

// Mirrors LIVE_GREEN_HOURS_UTC in src/lib/cryptoAutoTrade.functions.ts.
const GREEN_HOURS = new Set([8, 11, 12, 16, 19, 20, 21, 22]);

export interface AutoTradeGreenStats {
  cutoffIso: string;
  totalFires: number;
  settled: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnlUsd: number;
  last24hFires: number;
  last24hWins: number;
  last24hLosses: number;
  last24hPnlUsd: number;
  last20: Array<{ won: boolean; pnl: number; settledAt: string }>;
  streak: number;
  killSwitch: "LIVE" | "PAUSE" | "warm-up";
}

export const getAutoTradeGreenStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutoTradeGreenStats> => {
    const { data, error } = await context.supabase
      .from("auto_trade_orders")
      .select("status, pnl_usd, settled_at, close_time")
      .eq("user_id", context.userId)
      .eq("mode", "live")
      .in("status", ["settled_win", "settled_loss"])
      .gte("settled_at", AUTO_TRADE_GREEN_STATS_CUTOFF_ISO)
      .order("settled_at", { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);

    const rows = (data ?? []).filter(r => {
      const ref = r.settled_at ?? r.close_time;
      if (!ref) return false;
      const h = new Date(ref).getUTCHours();
      return GREEN_HOURS.has(h);
    });

    const nowMs = Date.now();
    let wins = 0, losses = 0, pnl = 0;
    let w24 = 0, l24 = 0, pnl24 = 0;
    for (const r of rows) {
      const won = r.status === "settled_win";
      const p = Number(r.pnl_usd) || 0;
      if (won) wins++; else losses++;
      pnl += p;
      const t = new Date((r.settled_at ?? r.close_time)!).getTime();
      if (t >= nowMs - 24 * 3600e3) {
        if (won) w24++; else l24++;
        pnl24 += p;
      }
    }

    const last20 = rows.slice(0, 20).map(r => ({
      won: r.status === "settled_win",
      pnl: Number(r.pnl_usd) || 0,
      settledAt: (r.settled_at ?? r.close_time) as string,
    }));

    let streak = 0;
    for (const r of rows) {
      if (r.status === "settled_win") streak++; else break;
    }

    const settled = wins + losses;
    const winRate = settled ? wins / settled : null;

    let killSwitch: "LIVE" | "PAUSE" | "warm-up" = "warm-up";
    if (settled >= 20) killSwitch = winRate !== null && winRate < 0.55 ? "PAUSE" : "LIVE";

    return {
      cutoffIso: AUTO_TRADE_GREEN_STATS_CUTOFF_ISO,
      totalFires: rows.length,
      settled,
      wins,
      losses,
      winRate,
      pnlUsd: Math.round(pnl * 100) / 100,
      last24hFires: w24 + l24,
      last24hWins: w24,
      last24hLosses: l24,
      last24hPnlUsd: Math.round(pnl24 * 100) / 100,
      last20,
      streak,
      killSwitch,
    };
  });
