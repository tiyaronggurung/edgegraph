// Read-only daily performance breakdown. Complements ModelScorecardPanel.
// Focus: trading-performance metrics (P/L, EV, win rate, avg ask/edge, Brier)
// segmented by confidence / time / sigma / side, with configurable date range.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDailyPerformance, type DailyPerfResult, type PerfBucketRow, type PerfRange } from "@/lib/dailyPerformance.functions";
import { RefreshCw } from "lucide-react";

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const usd = (n: number) => `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
const num = (n: number, d = 3) => n.toFixed(d);

function BucketTable({ title, rows }: { title: string; rows: PerfBucketRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">Bucket</th>
              <th className="px-2 py-1 text-right">N</th>
              <th className="px-2 py-1 text-right">Win</th>
              <th className="px-2 py-1 text-right">Ask</th>
              <th className="px-2 py-1 text-right">Edge</th>
              <th className="px-2 py-1 text-right">EV</th>
              <th className="px-2 py-1 text-right">P/L</th>
              <th className="px-2 py-1 text-right">Brier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="px-2 py-1 font-mono">{r.key}</td>
                <td className="px-2 py-1 text-right">{r.n}</td>
                <td className="px-2 py-1 text-right">{pct(r.hitRate, 1)}</td>
                <td className="px-2 py-1 text-right">{r.avgAsk != null ? `${(r.avgAsk * 100).toFixed(0)}¢` : "—"}</td>
                <td className="px-2 py-1 text-right">{r.avgEdgePts != null ? `${r.avgEdgePts.toFixed(1)}pp` : "—"}</td>
                <td className="px-2 py-1 text-right">{usd(r.evUsd)}</td>
                <td className={`px-2 py-1 text-right ${r.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>{usd(r.pnlUsd)}</td>
                <td className="px-2 py-1 text-right">{num(r.brier)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DailyPerformancePanel() {
  const fn = useServerFn(getDailyPerformance);
  const [range, setRange] = useState<PerfRange>("7d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const q = useQuery<DailyPerfResult>({
    queryKey: ["daily-performance", range, customFrom, customTo],
    queryFn: () => fn({ data: { range, from: customFrom || undefined, to: customTo || undefined } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const RangeBtn = ({ value, label }: { value: PerfRange; label: string }) => (
    <button
      type="button"
      onClick={() => setRange(value)}
      className={`px-2 py-1 text-xs rounded border ${range === value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-semibold">Daily performance</div>
          <div className="text-xs text-muted-foreground">
            Realized P/L, EV, and win rate on accepted trades + counterfactual P/L on skipped trades.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RangeBtn value="today" label="Today" />
          <RangeBtn value="7d" label="7d" />
          <RangeBtn value="30d" label="30d" />
          <RangeBtn value="custom" label="Custom" />
          <button
            type="button"
            onClick={() => q.refetch()}
            className="p-1.5 rounded hover:bg-muted"
            aria-label="Refresh performance"
          >
            <RefreshCw className={`w-4 h-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {range === "custom" && (
        <div className="flex gap-2 items-center text-xs">
          <label className="flex items-center gap-1">
            From
            <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bg-background border border-border rounded px-2 py-1" />
          </label>
          <label className="flex items-center gap-1">
            To
            <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bg-background border border-border rounded px-2 py-1" />
          </label>
        </div>
      )}

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.isError && <div className="text-sm text-red-400">Failed to load performance report.</div>}

      {q.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Accepted" value={q.data.accepted.n.toString()} sub={`${q.data.accepted.wins} wins`} />
            <Stat label="Win rate" value={pct(q.data.accepted.hitRate, 1)} accent={q.data.accepted.hitRate >= 0.55 ? "good" : q.data.accepted.hitRate < 0.5 ? "bad" : undefined} />
            <Stat label="Realized P/L" value={usd(q.data.accepted.pnlUsd)} accent={q.data.accepted.pnlUsd >= 0 ? "good" : "bad"} sub="$10 flat" />
            <Stat label="Brier" value={num(q.data.accepted.brier)} sub="lower better" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Skipped" value={q.data.skipped.n.toString()} sub={`${q.data.skipped.settled} settled`} />
            <Stat
              label="Skip win rate"
              value={q.data.skipped.settled > 0 ? pct(q.data.skipped.wouldHaveWon / q.data.skipped.settled, 1) : "—"}
              sub="would-have-won"
            />
            <Stat
              label="Missed P/L"
              value={usd(q.data.skipped.counterfactualPnl)}
              accent={q.data.skipped.counterfactualPnl >= 0 ? "bad" : "good"}
              sub="if we'd taken them"
            />
            <Stat label="Avg entry ask" value={q.data.accepted.avgAsk != null ? `${(q.data.accepted.avgAsk * 100).toFixed(1)}¢` : "—"} />
          </div>

          <div className="space-y-3">
            <BucketTable title="By confidence" rows={q.data.byConfidence} />
            <BucketTable title="By time-to-close" rows={q.data.byTime} />
            <BucketTable title="By distance (σ)" rows={q.data.bySigma} />
            <BucketTable title="By side" rows={q.data.bySide} />
          </div>

          {q.data.skipReasons.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Skip reasons</div>
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Reason</th>
                      <th className="px-2 py-1 text-right">Skipped</th>
                      <th className="px-2 py-1 text-right">Settled</th>
                      <th className="px-2 py-1 text-right">Would-win</th>
                      <th className="px-2 py-1 text-right">Missed P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.skipReasons.map(r => (
                      <tr key={r.reason} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono">{r.reason}</td>
                        <td className="px-2 py-1 text-right">{r.n}</td>
                        <td className="px-2 py-1 text-right">{r.settled}</td>
                        <td className="px-2 py-1 text-right">
                          {r.settled > 0 ? `${r.wouldHaveWon} (${pct(r.wouldHaveWon / r.settled, 0)})` : "—"}
                        </td>
                        <td className={`px-2 py-1 text-right ${r.counterfactualPnl >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {usd(r.counterfactualPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Missed P/L shows what we would have made/lost if we had taken each skipped trade at $10 flat. Green = the gate saved money.
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
