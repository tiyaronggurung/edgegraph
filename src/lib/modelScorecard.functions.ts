// Read-only scorecard over settled btc_model_predictions.
// Zero writes. Computes overall stats, calibration buckets, breakdowns, and
// a 7-day rolling Brier trend. Handler body is stripped from the client bundle.
import { createServerFn } from "@tanstack/react-start";

export interface CalibrationBucket {
  bucket: string;          // e.g. "0-20"
  low: number;             // 0..1
  high: number;            // 0..1
  n: number;
  predicted: number;       // avg model prob on locked side
  actual: number;          // win rate
}

export interface BreakdownRow {
  key: string;
  n: number;
  hitRate: number;
  brier: number;
  avgEdgePts: number | null;
}

export interface TrendPoint {
  day: string;             // YYYY-MM-DD
  n: number;
  hitRate: number;
  brier: number;
}

export interface ScorecardResult {
  totalSettled: number;
  hitRate: number;
  brier: number;
  logLoss: number;
  avgEdgePts: number | null;
  calibration: CalibrationBucket[];
  byTimeBucket: BreakdownRow[];
  bySigma: BreakdownRow[];
  bySide: BreakdownRow[];
  trend: TrendPoint[];
  lastSettledAt: string | null;
}

function sigmaBucketOf(sigDist: number | null): string {
  if (sigDist == null || !Number.isFinite(sigDist)) return "unknown";
  if (sigDist < 0.5) return "0-0.5σ";
  if (sigDist < 1.0) return "0.5-1σ";
  if (sigDist < 2.0) return "1-2σ";
  if (sigDist < 3.0) return "2-3σ";
  return "3σ+";
}

function sigDistFrom(r: {
  spot_at_snapshot: number | null;
  strike: number | null;
  sigma_at_snapshot: number | null;
  snapshot_seconds_to_close: number | null;
}): number | null {
  const spot = Number(r.spot_at_snapshot);
  const strike = Number(r.strike);
  const sigma = Number(r.sigma_at_snapshot);
  const secs = Number(r.snapshot_seconds_to_close);
  if (!spot || !strike || !sigma || sigma <= 0 || !secs) return null;
  const mins = secs / 60;
  const stdMoveUsd = (sigma / 100) * Math.sqrt(mins) * spot;
  if (stdMoveUsd <= 0) return null;
  return Math.abs(spot - strike) / stdMoveUsd;
}

export const getModelScorecard = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScorecardResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("side, model_prob, was_correct, time_bucket, sigma_at_snapshot, spot_at_snapshot, strike, snapshot_seconds_to_close, edge_pts, settled_at")
      .not("outcome", "is", null)
      .order("settled_at", { ascending: false })
      .limit(20000);

    if (error) throw new Error(error.message);
    const all = (rows ?? []).filter(r => r.model_prob != null && r.was_correct != null);

    const n = all.length;
    if (n === 0) {
      return {
        totalSettled: 0, hitRate: 0, brier: 0, logLoss: 0, avgEdgePts: null,
        calibration: [], byTimeBucket: [], bySigma: [], bySide: [], trend: [],
        lastSettledAt: null,
      };
    }

    // Side-locked model prob (probability model assigned to the side actually taken).
    const sideProb = (r: typeof all[number]) => {
      const p = Number(r.model_prob);
      return r.side === "YES" ? p : 1 - p;
    };

    let wins = 0;
    let brierSum = 0;
    let logLossSum = 0;
    let edgeSum = 0;
    let edgeN = 0;

    for (const r of all) {
      const p = Math.max(1e-6, Math.min(1 - 1e-6, sideProb(r)));
      const y = r.was_correct ? 1 : 0;
      if (y) wins += 1;
      brierSum += (p - y) ** 2;
      logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      if (r.edge_pts != null) { edgeSum += Number(r.edge_pts); edgeN += 1; }
    }

    // Calibration: 5 buckets on side-locked model prob.
    const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
    const cal: CalibrationBucket[] = [];
    for (let i = 0; i < 5; i++) {
      const lo = edges[i], hi = edges[i + 1];
      const bucket = all.filter(r => { const p = sideProb(r); return p >= lo && p < hi; });
      const bn = bucket.length;
      const bWins = bucket.filter(r => r.was_correct).length;
      const pSum = bucket.reduce((s, r) => s + sideProb(r), 0);
      cal.push({
        bucket: `${Math.round(lo * 100)}-${Math.round(Math.min(1, hi) * 100)}`,
        low: lo, high: Math.min(1, hi),
        n: bn,
        predicted: bn > 0 ? pSum / bn : 0,
        actual: bn > 0 ? bWins / bn : 0,
      });
    }

    // Generic breakdown helper.
    const breakdown = (groupOf: (r: typeof all[number]) => string): BreakdownRow[] => {
      const m = new Map<string, { n: number; wins: number; brier: number; edgeSum: number; edgeN: number }>();
      for (const r of all) {
        const k = groupOf(r);
        const g = m.get(k) ?? { n: 0, wins: 0, brier: 0, edgeSum: 0, edgeN: 0 };
        const p = Math.max(1e-6, Math.min(1 - 1e-6, sideProb(r)));
        const y = r.was_correct ? 1 : 0;
        g.n += 1;
        if (y) g.wins += 1;
        g.brier += (p - y) ** 2;
        if (r.edge_pts != null) { g.edgeSum += Number(r.edge_pts); g.edgeN += 1; }
        m.set(k, g);
      }
      return [...m.entries()]
        .map(([key, g]) => ({
          key, n: g.n,
          hitRate: g.wins / g.n,
          brier: g.brier / g.n,
          avgEdgePts: g.edgeN > 0 ? g.edgeSum / g.edgeN : null,
        }))
        .sort((a, b) => b.n - a.n);
    };

    const byTimeBucket = breakdown(r => (r.time_bucket as string) ?? "unknown");
    const bySigma = breakdown(r => sigmaBucketOf(sigDistFrom(r as any)));
    const bySide = breakdown(r => (r.side as string));

    // 7-day rolling trend (per-day).
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const dayMap = new Map<string, { n: number; wins: number; brier: number }>();
    for (const r of all) {
      const t = r.settled_at ? new Date(r.settled_at as string).getTime() : 0;
      if (t < cutoff) continue;
      const day = new Date(t).toISOString().slice(0, 10);
      const g = dayMap.get(day) ?? { n: 0, wins: 0, brier: 0 };
      const p = Math.max(1e-6, Math.min(1 - 1e-6, sideProb(r)));
      const y = r.was_correct ? 1 : 0;
      g.n += 1; if (y) g.wins += 1; g.brier += (p - y) ** 2;
      dayMap.set(day, g);
    }
    const trend: TrendPoint[] = [...dayMap.entries()]
      .map(([day, g]) => ({ day, n: g.n, hitRate: g.wins / g.n, brier: g.brier / g.n }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return {
      totalSettled: n,
      hitRate: wins / n,
      brier: brierSum / n,
      logLoss: logLossSum / n,
      avgEdgePts: edgeN > 0 ? edgeSum / edgeN : null,
      calibration: cal,
      byTimeBucket,
      bySigma,
      bySide,
      trend,
      lastSettledAt: (all[0]?.settled_at as string | null) ?? null,
    };
  },
);
