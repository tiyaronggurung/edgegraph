// Read-only Phase 2 EV report: aggregates ev_decision_log by calibration
// bucket, snapshot time bucket, and regime tag. Public read (settled rows
// only) — no user data exposed, no gating decisions made here.
import { createServerFn } from "@tanstack/react-start";

export type EvBucketRow = {
  key: string;
  n: number;
  nSettled: number;
  hitRate: number;      // realized win rate on settled rows
  avgEdgePts: number;   // mean edge in pp
  avgEvPer10: number;   // mean shadow EV on $10 stake
  pnlUngated: number;   // sum realized_pnl_10 (all rows that would_fire)
  pnlGated: number;     // sum realized_pnl_10 where would_fire_gated=true
  nFiredGated: number;
};

export type EvReport = {
  windowDays: number;
  totalRows: number;
  totalSettled: number;
  overallHitRate: number;
  overallPnlUngated: number;
  overallPnlGated: number;
  byCalibration: EvBucketRow[];
  bySnapshotBucket: EvBucketRow[];
  byRegime: EvBucketRow[];
};

function agg(rows: any[], keyOf: (r: any) => string | null): EvBucketRow[] {
  const map = new Map<string, {
    n: number; nSettled: number; wins: number;
    edgeSum: number; evSum: number;
    pnlUngated: number; pnlGated: number; nFiredGated: number;
  }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    let b = map.get(k);
    if (!b) { b = { n: 0, nSettled: 0, wins: 0, edgeSum: 0, evSum: 0, pnlUngated: 0, pnlGated: 0, nFiredGated: 0 }; map.set(k, b); }
    b.n++;
    b.edgeSum += Number(r.edge_pts) || 0;
    b.evSum += Number(r.ev_per_stake_10) || 0;
    if (r.actual_outcome != null) {
      b.nSettled++;
      if (r.was_correct) b.wins++;
      const pnl = Number(r.realized_pnl_10) || 0;
      if (r.would_fire) b.pnlUngated += pnl;
      if (r.would_fire_gated) { b.pnlGated += pnl; b.nFiredGated++; }
    }
  }
  return Array.from(map.entries()).map(([key, b]) => ({
    key,
    n: b.n,
    nSettled: b.nSettled,
    hitRate: b.nSettled ? b.wins / b.nSettled : 0,
    avgEdgePts: b.n ? b.edgeSum / b.n : 0,
    avgEvPer10: b.n ? b.evSum / b.n : 0,
    pnlUngated: Math.round(b.pnlUngated * 100) / 100,
    pnlGated: Math.round(b.pnlGated * 100) / 100,
    nFiredGated: b.nFiredGated,
  })).sort((a, b) => a.key.localeCompare(b.key));
}

export const getEvReport = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as { days?: number };
    const days = Math.max(1, Math.min(30, Number(d.days) || 7));
    return { days };
  })
  .handler(async ({ data }): Promise<EvReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86400_000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("ev_decision_log")
      .select("snapshot_bucket, calibration_bucket, regime_tag, edge_pts, ev_per_stake_10, would_fire, would_fire_gated, actual_outcome, was_correct, realized_pnl_10")
      .gte("close_time", since)
      .limit(50000);
    if (error) throw new Error(error.message);
    const all = rows ?? [];
    const settled = all.filter(r => r.actual_outcome != null);
    const wins = settled.filter(r => r.was_correct).length;
    const pnlUngated = settled.reduce((s, r) => s + (r.would_fire ? (Number(r.realized_pnl_10) || 0) : 0), 0);
    const pnlGated = settled.reduce((s, r) => s + (r.would_fire_gated ? (Number(r.realized_pnl_10) || 0) : 0), 0);
    return {
      windowDays: data.days,
      totalRows: all.length,
      totalSettled: settled.length,
      overallHitRate: settled.length ? wins / settled.length : 0,
      overallPnlUngated: Math.round(pnlUngated * 100) / 100,
      overallPnlGated: Math.round(pnlGated * 100) / 100,
      byCalibration: agg(all, r => r.calibration_bucket),
      bySnapshotBucket: agg(all, r => r.snapshot_bucket),
      byRegime: agg(all, r => r.regime_tag),
    };
  });
