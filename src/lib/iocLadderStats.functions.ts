// IOC Ladder Stats — read-only aggregates for the dashboard widget.
// Reads auto_trade_orders.inputs_snapshot->iocLadder to compute:
//   - success rate (filled / total attempts)
//   - avg cents climbed on fills
//   - P&L bucketed by cents climbed (0, +1, +2, +3)
// Also picks up unfilled ladder-exhausted attempts logged into
// auto_odds_study_log with note prefix "ioc_ladder_exhausted:".

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IocLadderBucket = {
  climbedCents: number;   // 0, 1, 2, 3
  count: number;
  wins: number;
  losses: number;
  pnlUsd: number;
  avgPnlUsd: number;
};

export type IocLadderStats = {
  windowDays: number;
  totalAttempts: number;      // filled + exhausted
  filledCount: number;
  exhaustedCount: number;
  successRatePct: number;     // filled / total * 100
  avgClimbCents: number;      // mean climbedCents across filled
  buckets: IocLadderBucket[]; // by climbedCents on filled orders
  totalPnlUsd: number;        // across filled orders in window
};

export const getIocLadderStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IocLadderStats> => {
    const { supabase, userId } = context;
    const windowDays = 7;
    const sinceIso = new Date(Date.now() - windowDays * 86400_000).toISOString();

    // Filled ladder attempts live on auto_trade_orders.inputs_snapshot.iocLadder
    const { data: orders } = await supabase
      .from("auto_trade_orders")
      .select("id, status, pnl_usd, inputs_snapshot, created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .not("inputs_snapshot", "is", null)
      .limit(2000);

    // Exhausted (unfilled) ladders logged on auto_odds_study_log
    const { data: exhaustedRows } = await supabase
      .from("auto_odds_study_log")
      .select("id, note, created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .ilike("note", "ioc_ladder_exhausted:%")
      .limit(2000);

    const bucketMap = new Map<number, IocLadderBucket>();
    let filledCount = 0;
    let climbSum = 0;
    let totalPnl = 0;

    for (const row of orders ?? []) {
      const snap = (row as any).inputs_snapshot as any;
      const ladder = snap?.iocLadder;
      if (!ladder || ladder.filled !== true) continue;
      const climbed = Number(ladder.climbedCents ?? 0);
      const pnl = Number((row as any).pnl_usd ?? 0);
      filledCount += 1;
      climbSum += climbed;
      totalPnl += pnl;
      const key = Math.max(0, Math.min(3, Math.round(climbed)));
      const b = bucketMap.get(key) ?? {
        climbedCents: key, count: 0, wins: 0, losses: 0, pnlUsd: 0, avgPnlUsd: 0,
      };
      b.count += 1;
      if ((row as any).status === "settled_win") b.wins += 1;
      else if ((row as any).status === "settled_loss") b.losses += 1;
      b.pnlUsd += pnl;
      bucketMap.set(key, b);
    }
    const buckets = Array.from(bucketMap.values())
      .map(b => ({ ...b, avgPnlUsd: b.count > 0 ? b.pnlUsd / b.count : 0 }))
      .sort((a, b) => a.climbedCents - b.climbedCents);

    const exhaustedCount = (exhaustedRows ?? []).length;
    const totalAttempts = filledCount + exhaustedCount;
    const successRatePct = totalAttempts > 0 ? (filledCount / totalAttempts) * 100 : 0;
    const avgClimbCents = filledCount > 0 ? climbSum / filledCount : 0;

    return {
      windowDays,
      totalAttempts,
      filledCount,
      exhaustedCount,
      successRatePct,
      avgClimbCents,
      buckets,
      totalPnlUsd: totalPnl,
    };
  });
