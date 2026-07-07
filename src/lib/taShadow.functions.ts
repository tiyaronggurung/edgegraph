// TA Shadow Study — server functions.
// SHADOW-ONLY: writes to auto_trade_ta_shadow, reads for reporting. Nothing
// here influences live trading, gates, exits, or the buy path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface TaShadowLogInput {
  order_id?: string | null;
  ticker?: string | null;
  side_evaluated?: string | null;
  kalshi_price_cents?: number | null;
  model_prob?: number | null;
  edge_pts?: number | null;
  kalshi_direction: "YES" | "NO" | "neutral";
  model_direction: "YES" | "NO" | "neutral";
  ta_direction_1m: "YES" | "NO" | "neutral";
  ta_direction_5m: "YES" | "NO" | "neutral";
  ta_direction_combined: "YES" | "NO" | "neutral";
  ta_confidence: number;
  ta_reasons: string[];
  trend_1m: "up" | "down" | "flat";
  trend_5m: "up" | "down" | "flat";
  support_level: number | null;
  resistance_level: number | null;
  nearest_round_level: number | null;
  rejection_wick_flag: boolean;
}

function agreementFlags(k: string, m: string, t: string) {
  const dirs = [k, m, t];
  const yes = dirs.filter((d) => d === "YES").length;
  const no = dirs.filter((d) => d === "NO").length;
  const all_three_agree = (yes === 3 || no === 3);
  const two_of_three_agree = !all_three_agree && (yes >= 2 || no >= 2);
  const ta_disagrees_kalshi = t !== "neutral" && k !== "neutral" && t !== k;
  const ta_disagrees_model = t !== "neutral" && m !== "neutral" && t !== m;
  return { all_three_agree, two_of_three_agree, ta_disagrees_kalshi, ta_disagrees_model };
}

export const logTaShadow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: TaShadowLogInput) => data)
  .handler(async ({ data, context }): Promise<{ id: string | null; skipped?: boolean }> => {
    const { supabase, userId } = context;

    // If this order already has a shadow row, skip (idempotent).
    if (data.order_id) {
      const { data: existing } = await supabase
        .from("auto_trade_ta_shadow")
        .select("id")
        .eq("user_id", userId)
        .eq("order_id", data.order_id)
        .maybeSingle();
      if (existing) return { id: existing.id, skipped: true };
    }

    const flags = agreementFlags(data.kalshi_direction, data.model_direction, data.ta_direction_combined);

    const { data: inserted, error } = await supabase
      .from("auto_trade_ta_shadow")
      .insert({
        user_id: userId,
        order_id: data.order_id ?? null,
        ticker: data.ticker ?? null,
        side_evaluated: data.side_evaluated ?? null,
        kalshi_price_cents: data.kalshi_price_cents ?? null,
        model_prob: data.model_prob ?? null,
        edge_pts: data.edge_pts ?? null,
        kalshi_direction: data.kalshi_direction,
        model_direction: data.model_direction,
        ta_direction_1m: data.ta_direction_1m,
        ta_direction_5m: data.ta_direction_5m,
        ta_direction_combined: data.ta_direction_combined,
        ta_confidence: data.ta_confidence,
        ta_reasons: data.ta_reasons,
        trend_1m: data.trend_1m,
        trend_5m: data.trend_5m,
        support_level: data.support_level,
        resistance_level: data.resistance_level,
        nearest_round_level: data.nearest_round_level,
        rejection_wick_flag: data.rejection_wick_flag,
        ...flags,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

// Backfill actual outcomes onto shadow rows once their order settles.
export const settleTaShadow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ updated: number }> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("auto_trade_ta_shadow")
      .select("id, order_id")
      .eq("user_id", userId)
      .is("actual_outcome", null)
      .not("order_id", "is", null)
      .limit(500);
    if (error) throw new Error(error.message);
    if (!rows?.length) return { updated: 0 };

    const orderIds = rows.map((r) => r.order_id).filter(Boolean) as string[];
    const { data: orders } = await supabase
      .from("auto_trade_orders")
      .select("id, status, pnl_usd, updated_at")
      .in("id", orderIds)
      .in("status", ["settled_win", "settled_loss"]);

    const byId = new Map((orders ?? []).map((o: any) => [o.id, o]));
    let updated = 0;
    for (const r of rows) {
      const o = byId.get(r.order_id!);
      if (!o) continue;
      const pnl = Number(o.pnl_usd ?? 0);
      const outcome = pnl >= 0 ? "win" : "loss";
      const full_loss = pnl <= -50; // rough "full-loss" heuristic; refine after data lands
      await supabase
        .from("auto_trade_ta_shadow")
        .update({
          actual_outcome: outcome,
          actual_pnl_usd: pnl,
          full_loss,
          settled_at: o.updated_at,
        })
        .eq("id", r.id);
      updated++;
    }
    return { updated };
  });

export interface TaShadowBucketStat {
  bucket: string;
  n: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_pnl: number;
  full_loss_rate: number;
}

export interface TaShadowReport {
  total: number;
  settled: number;
  buckets: TaShadowBucketStat[];
  hypothetical_all_three_gate: {
    would_skip: number;
    losses_saved_usd: number;
    wins_killed_usd: number;
    net_usd: number;
  };
}

export const getTaShadowReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaShadowReport> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("auto_trade_ta_shadow")
      .select("all_three_agree, two_of_three_agree, ta_disagrees_kalshi, ta_disagrees_model, actual_outcome, actual_pnl_usd, full_loss, kalshi_direction, ta_direction_combined")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const all = rows ?? [];
    const settled = all.filter((r: any) => r.actual_outcome != null);

    const bucketDefs: Array<{ key: string; label: string; test: (r: any) => boolean }> = [
      { key: "all3", label: "All 3 agree", test: (r) => r.all_three_agree },
      { key: "2of3", label: "2 of 3 agree", test: (r) => r.two_of_three_agree },
      { key: "ta_vs_kalshi", label: "TA disagrees w/ Kalshi", test: (r) => r.ta_disagrees_kalshi },
      { key: "ta_vs_model", label: "TA disagrees w/ model", test: (r) => r.ta_disagrees_model },
    ];

    const buckets: TaShadowBucketStat[] = bucketDefs.map(({ label, test }) => {
      const rs = settled.filter(test);
      const wins = rs.filter((r: any) => r.actual_outcome === "win").length;
      const losses = rs.filter((r: any) => r.actual_outcome === "loss").length;
      const pnl = rs.reduce((a: number, r: any) => a + Number(r.actual_pnl_usd ?? 0), 0);
      const fulls = rs.filter((r: any) => r.full_loss).length;
      const n = rs.length;
      return {
        bucket: label,
        n,
        wins,
        losses,
        win_rate: n ? wins / n : 0,
        avg_pnl: n ? pnl / n : 0,
        full_loss_rate: n ? fulls / n : 0,
      };
    });

    // "If we required all 3 to agree" — what would we have skipped, and what net $?
    const wouldSkipRows = settled.filter((r: any) => !r.all_three_agree);
    let losses_saved_usd = 0;
    let wins_killed_usd = 0;
    for (const r of wouldSkipRows as any[]) {
      const p = Number(r.actual_pnl_usd ?? 0);
      if (p < 0) losses_saved_usd += -p;
      else wins_killed_usd += p;
    }

    return {
      total: all.length,
      settled: settled.length,
      buckets,
      hypothetical_all_three_gate: {
        would_skip: wouldSkipRows.length,
        losses_saved_usd,
        wins_killed_usd,
        net_usd: losses_saved_usd - wins_killed_usd,
      },
    };
  });
