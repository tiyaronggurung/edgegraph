// Read-only Model Scorecard. Renders overall stats + calibration + breakdowns
// + 7-day trend from btc_model_predictions. Zero writes, zero decision impact.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getModelScorecard, type ScorecardResult, type CalibrationBucket, type BreakdownRow } from "@/lib/modelScorecard.functions";
import { RefreshCw } from "lucide-react";

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const num = (n: number, d = 3) => n.toFixed(d);

function CalibBar({ b }: { b: CalibrationBucket }) {
  if (b.n === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="font-mono">{b.bucket}%</div>
        <div>—</div>
      </div>
    );
  }
  const gap = b.actual - b.predicted;
  const good = Math.abs(gap) < 0.05;
  return (
    <div className="text-xs">
      <div className="font-mono text-muted-foreground">{b.bucket}%</div>
      <div className="flex items-baseline gap-1">
        <span className="font-semibold">{pct(b.actual, 0)}</span>
        <span className="text-muted-foreground">/ {pct(b.predicted, 0)}</span>
      </div>
      <div className={good ? "text-emerald-400" : gap > 0 ? "text-sky-400" : "text-amber-400"}>
        {gap >= 0 ? "+" : ""}{(gap * 100).toFixed(1)}pp
      </div>
      <div className="text-muted-foreground">n={b.n}</div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">Bucket</th>
              <th className="px-2 py-1 text-right">N</th>
              <th className="px-2 py-1 text-right">Hit</th>
              <th className="px-2 py-1 text-right">Brier</th>
              <th className="px-2 py-1 text-right">Avg Edge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="px-2 py-1 font-mono">{r.key}</td>
                <td className="px-2 py-1 text-right">{r.n}</td>
                <td className="px-2 py-1 text-right">{pct(r.hitRate, 1)}</td>
                <td className="px-2 py-1 text-right">{num(r.brier)}</td>
                <td className="px-2 py-1 text-right">{r.avgEdgePts != null ? r.avgEdgePts.toFixed(1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ModelScorecardPanel() {
  const fn = useServerFn(getModelScorecard);
  const q = useQuery<ScorecardResult>({
    queryKey: ["model-scorecard"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Model scorecard</div>
          <div className="text-xs text-muted-foreground">
            Read-only accuracy check over settled predictions. Lower Brier = better calibration.
          </div>
        </div>
        <button
          type="button"
          onClick={() => q.refetch()}
          className="p-1.5 rounded hover:bg-muted"
          aria-label="Refresh scorecard"
        >
          <RefreshCw className={`w-4 h-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.isError && <div className="text-sm text-red-400">Failed to load scorecard.</div>}

      {q.data && q.data.totalSettled === 0 && (
        <div className="text-sm text-muted-foreground">No settled predictions yet.</div>
      )}

      {q.data && q.data.totalSettled > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Settled" value={q.data.totalSettled.toString()} />
            <Stat label="Hit rate" value={pct(q.data.hitRate, 1)} accent={q.data.hitRate >= 0.55 ? "good" : q.data.hitRate < 0.5 ? "bad" : undefined} />
            <Stat label="Brier" value={num(q.data.brier)} accent={q.data.brier < 0.24 ? "good" : q.data.brier > 0.26 ? "bad" : undefined} sub="lower better" />
            <Stat label="Log loss" value={num(q.data.logLoss)} sub="lower better" />
            <Stat label="Avg edge" value={q.data.avgEdgePts != null ? `${q.data.avgEdgePts.toFixed(1)}pp` : "—"} />
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">Calibration (actual / predicted)</div>
            <div className="grid grid-cols-5 gap-2 rounded-md border border-border p-2">
              {q.data.calibration.map(b => <CalibBar key={b.bucket} b={b} />)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Actual win-rate vs model's side-locked probability. Big gaps = miscalibrated bucket.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <BreakdownTable title="By time-to-close" rows={q.data.byTimeBucket} />
            <BreakdownTable title="By distance (σ)" rows={q.data.bySigma} />
            <BreakdownTable title="By side" rows={q.data.bySide} />
          </div>

          {q.data.trend.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Last 7 days</div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Day</th>
                      <th className="px-2 py-1 text-right">N</th>
                      <th className="px-2 py-1 text-right">Hit</th>
                      <th className="px-2 py-1 text-right">Brier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.trend.map(t => (
                      <tr key={t.day} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono">{t.day}</td>
                        <td className="px-2 py-1 text-right">{t.n}</td>
                        <td className="px-2 py-1 text-right">{pct(t.hitRate, 1)}</td>
                        <td className="px-2 py-1 text-right">{num(t.brier)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "good" | "bad" }) {
  const color = accent === "good" ? "text-emerald-400" : accent === "bad" ? "text-red-400" : "text-foreground";
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
