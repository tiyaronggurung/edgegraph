// Phase 2 shadow EV report. Read-only. Shows calibration by probability
// bucket, entry-timing by snapshot bucket, and regime breakdown, plus
// ungated vs gated P/L on a hypothetical $10 flat stake.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { getEvReport, type EvBucketRow } from "@/lib/evReport.functions";

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const usd = (n: number) => `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
const num = (n: number, d = 2) => n.toFixed(d);

function BucketTable({ title, rows }: { title: string; rows: EvBucketRow[] }) {
  if (!rows.length) return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <div className="text-xs text-muted-foreground">No data yet.</div>
    </div>
  );
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">Bucket</th>
              <th className="px-2 py-1 text-right">N</th>
              <th className="px-2 py-1 text-right">Settled</th>
              <th className="px-2 py-1 text-right">Hit</th>
              <th className="px-2 py-1 text-right">Avg Edge</th>
              <th className="px-2 py-1 text-right">Avg EV/$10</th>
              <th className="px-2 py-1 text-right">P/L Ungated</th>
              <th className="px-2 py-1 text-right">P/L Gated (N)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="px-2 py-1 font-mono">{r.key}</td>
                <td className="px-2 py-1 text-right">{r.n}</td>
                <td className="px-2 py-1 text-right">{r.nSettled}</td>
                <td className="px-2 py-1 text-right">{r.nSettled ? pct(r.hitRate) : "—"}</td>
                <td className="px-2 py-1 text-right">{num(r.avgEdgePts)}pp</td>
                <td className="px-2 py-1 text-right">{usd(r.avgEvPer10)}</td>
                <td className={`px-2 py-1 text-right ${r.pnlUngated >= 0 ? "text-emerald-400" : "text-red-400"}`}>{usd(r.pnlUngated)}</td>
                <td className={`px-2 py-1 text-right ${r.pnlGated >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {usd(r.pnlGated)} <span className="text-muted-foreground">({r.nFiredGated})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EvReportPanel() {
  const [days, setDays] = useState(7);
  const fetchReport = useServerFn(getEvReport);
  const q = useQuery({
    queryKey: ["ev-report", days],
    queryFn: () => fetchReport({ data: { days } }),
    staleTime: 60_000,
  });

  const r = q.data;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            🧪 Shadow EV Report <span className="text-[10px] font-normal text-muted-foreground">(Phase 2 · read-only)</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Model prob vs Kalshi ask. Ungated = every snapshot with EV&gt;0. Gated = also passes price ceiling + edge + confidence.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="text-xs bg-background border border-border rounded px-2 py-1"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            <option value={1}>1d</option>
            <option value={3}>3d</option>
            <option value={7}>7d</option>
            <option value={14}>14d</option>
            <option value={30}>30d</option>
          </select>
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {q.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {q.error && <div className="text-xs text-red-400">Failed: {(q.error as Error).message}</div>}

      {r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <Stat label="Snapshots" value={String(r.totalRows)} />
            <Stat label="Settled" value={String(r.totalSettled)} />
            <Stat label="Hit rate" value={r.totalSettled ? pct(r.overallHitRate) : "—"} />
            <Stat label="P/L ungated" value={usd(r.overallPnlUngated)} tone={r.overallPnlUngated >= 0 ? "pos" : "neg"} />
            <Stat label="P/L gated" value={usd(r.overallPnlGated)} tone={r.overallPnlGated >= 0 ? "pos" : "neg"} />
          </div>

          <BucketTable title="By probability bucket (calibration)" rows={r.byCalibration} />
          <BucketTable title="By snapshot bucket (entry timing)" rows={r.bySnapshotBucket} />
          <BucketTable title="By regime" rows={r.byRegime} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-red-400" : "";
  return (
    <div className="rounded-md border border-border bg-background px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
