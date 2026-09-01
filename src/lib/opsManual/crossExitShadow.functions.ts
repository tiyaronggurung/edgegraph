// Server functions for the Cross-Exit / Late-Flip shadow logger.
// Read-only w.r.t. live trading: backfills and reads shadow rows only.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface CrossExitStats {
  rows: number;
  settled: number;
  crossed: number;
  wouldExit: number;
  wouldFlip: number;
  holdPnlCents: number;
  exitPnlCents: number;
  combinedPnlCents: number;
}

/** Aggregate shadow performance over the last N days. */
export const crossExitShadowStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => ({
    days: Math.min(90, Math.max(1, Number(input?.days ?? 14))),
  }))
  .handler(async ({ data, context }): Promise<CrossExitStats> => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("btc_cross_exit_shadow")
      .select(
        "settled,cross_detected,would_exit,would_flip,hold_pnl_cents,exit_pnl_cents,combined_pnl_cents",
      )
      .gte("close_time", since)
      .limit(5000);
    if (error) throw new Error(error.message);

    const list = rows ?? [];
    const sum = (k: "hold_pnl_cents" | "exit_pnl_cents" | "combined_pnl_cents") =>
      list.reduce((s, r) => s + (Number(r[k]) || 0), 0);

    return {
      rows: list.length,
      settled: list.filter((r) => r.settled).length,
      crossed: list.filter((r) => r.cross_detected).length,
      wouldExit: list.filter((r) => r.would_exit).length,
      wouldFlip: list.filter((r) => r.would_flip).length,
      holdPnlCents: sum("hold_pnl_cents"),
      exitPnlCents: sum("exit_pnl_cents"),
      combinedPnlCents: sum("combined_pnl_cents"),
    };
  });

/** On-demand backfill over a date range (admin-triggered from the Ops page). */
export const crossExitShadowBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { startDate: string; endDate: string }) => {
    if (!input?.startDate || !input?.endDate) throw new Error("startDate and endDate are required");
    return { startDate: input.startDate, endDate: input.endDate };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_ops_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backfillCrossExitShadowRange } = await import("./crossExitShadow.server");
    const res = await backfillCrossExitShadowRange(supabaseAdmin, data.startDate, data.endDate);
    return { ok: res.ok, processed: res.processed, errors: res.errors.slice(0, 20) };
  });
