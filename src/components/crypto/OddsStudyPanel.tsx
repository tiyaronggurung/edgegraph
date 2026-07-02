import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

// Odds Study Panel
// Reads the last N rows of auto_odds_study_log for the signed-in user
// (RLS restricts by user_id). Shows:
//   - Flip count (crossed_50) and average |Δ¢| per tick
//   - Price↔odds correlation snapshot: average |Δspot| vs average |Δ¢|
//   - Time-bucket breakdown: for each bucket (>120s / 60-120s / 15-60s / <15s)
//     the row count, flip rate, avg |Δ¢|, and entered %
//
// Read-only. Does not touch trade logic.

interface Row {
  ticker: string;
  seconds_to_close: number | null;
  spot: number | null;
  yes_cents: number | null;
  no_cents: number | null;
  picked_side: string | null;
  model_side_prob: number | null;
  entered: boolean | null;
  hedge_fired: boolean | null;
  prior_yes_cents: number | null;
  yes_cents_delta: number | null;
  spot_delta: number | null;
  seconds_since_prior: number | null;
  crossed_50: boolean | null;
  time_bucket: string | null;
  created_at: string;
}

const BUCKETS = [">120s", "60-120s", "15-60s", "<15s"] as const;

export function OddsStudyPanel() {
  const q = useQuery({
    queryKey: ["odds-study-log"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("auto_odds_study_log")
        .select("ticker, seconds_to_close, spot, yes_cents, no_cents, picked_side, model_side_prob, entered, hedge_fired, prior_yes_cents, yes_cents_delta, spot_delta, seconds_since_prior, crossed_50, time_bucket, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });

  const stats = useMemo(() => {
    const rows = q.data ?? [];
    const withPrior = rows.filter(r => r.prior_yes_cents != null && r.yes_cents_delta != null);
    const flips = withPrior.filter(r => r.crossed_50).length;
    const avgAbsCentDelta = withPrior.length
      ? withPrior.reduce((s, r) => s + Math.abs(r.yes_cents_delta as number), 0) / withPrior.length
      : 0;
    const withSpot = withPrior.filter(r => r.spot_delta != null);
    const avgAbsSpotDelta = withSpot.length
      ? withSpot.reduce((s, r) => s + Math.abs(r.spot_delta as number), 0) / withSpot.length
      : 0;
    // Correlation: rows where spot and yes_cents_delta same-signed (spot up → picked ¢ up)
    const signed = withSpot.filter(r => Math.abs(r.spot_delta as number) > 5 && Math.abs(r.yes_cents_delta as number) >= 1);
    const aligned = signed.filter(r => Math.sign(r.spot_delta as number) === Math.sign(r.yes_cents_delta as number)).length;
    const alignRate = signed.length ? aligned / signed.length : null;

    const byBucket = BUCKETS.map(b => {
      const bucket = rows.filter(r => r.time_bucket === b);
      const bWithPrior = bucket.filter(r => r.yes_cents_delta != null);
      const bFlips = bucket.filter(r => r.crossed_50).length;
      const bEntered = bucket.filter(r => r.entered).length;
      const bAvgSwing = bWithPrior.length
        ? bWithPrior.reduce((s, r) => s + Math.abs(r.yes_cents_delta as number), 0) / bWithPrior.length
        : 0;
      return {
        bucket: b,
        count: bucket.length,
        flips: bFlips,
        flipRate: bucket.length ? bFlips / bucket.length : 0,
        avgSwing: bAvgSwing,
        entered: bEntered,
        enteredRate: bucket.length ? bEntered / bucket.length : 0,
      };
    });

    return { total: rows.length, flips, avgAbsCentDelta, avgAbsSpotDelta, alignRate, byBucket };
  }, [q.data]);

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Odds Study — price ↔ odds ↔ time</h2>
        <span className="text-[11px] text-muted-foreground">last {stats.total} snapshots</span>
      </div>

      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : stats.total === 0 ? (
        <div className="text-xs text-muted-foreground">No study snapshots yet. Rows are written every tick an auto-odds candidate is evaluated.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-border p-2">
              <div className="text-muted-foreground text-[10px] uppercase">Flip rate</div>
              <div className="text-sm font-semibold">{stats.total ? ((stats.flips / stats.total) * 100).toFixed(1) : "0"}%</div>
              <div className="text-[10px] text-muted-foreground">{stats.flips}/{stats.total} crossed 50¢</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-muted-foreground text-[10px] uppercase">Avg |Δ¢|</div>
              <div className="text-sm font-semibold">{stats.avgAbsCentDelta.toFixed(1)}¢</div>
              <div className="text-[10px] text-muted-foreground">picked side vs prior tick</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-muted-foreground text-[10px] uppercase">Avg |Δspot|</div>
              <div className="text-sm font-semibold">${stats.avgAbsSpotDelta.toFixed(1)}</div>
              <div className="text-[10px] text-muted-foreground">between snapshots</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-muted-foreground text-[10px] uppercase">Price↔odds alignment</div>
              <div className="text-sm font-semibold">{stats.alignRate == null ? "—" : `${(stats.alignRate * 100).toFixed(0)}%`}</div>
              <div className="text-[10px] text-muted-foreground">spot & ¢ same direction</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase text-muted-foreground mb-1">By time-to-close</div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left py-1">Bucket</th>
                  <th className="text-right py-1">Rows</th>
                  <th className="text-right py-1">Flip rate</th>
                  <th className="text-right py-1">Avg |Δ¢|</th>
                  <th className="text-right py-1">Entered</th>
                </tr>
              </thead>
              <tbody>
                {stats.byBucket.map(b => (
                  <tr key={b.bucket} className="border-t border-border/50">
                    <td className="py-1 font-mono">{b.bucket}</td>
                    <td className="text-right py-1">{b.count}</td>
                    <td className="text-right py-1">{b.count ? `${(b.flipRate * 100).toFixed(0)}%` : "—"} <span className="text-muted-foreground">({b.flips})</span></td>
                    <td className="text-right py-1">{b.avgSwing.toFixed(1)}¢</td>
                    <td className="text-right py-1">{b.entered} <span className="text-muted-foreground">({b.count ? (b.enteredRate * 100).toFixed(0) : 0}%)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] text-muted-foreground leading-snug">
            <strong>How to read:</strong> Flip rate = how often the picked side crossed the 50¢ line between snapshots. Alignment % = when both spot and ¢ moved noticeably, how often they moved the same direction (high = market tracks price cleanly; low = coin-flip / disagreement zone). Buckets with high flip rate near close = "detect the flip" zone — avoid or hedge.
          </div>
        </>
      )}
    </div>
  );
}
