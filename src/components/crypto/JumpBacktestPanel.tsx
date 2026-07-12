import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runJumpPolicyBacktest } from "@/lib/jumpBacktest.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Loader2 } from "lucide-react";

const POLICY_LABEL: Record<string, string> = {
  A_baseline: "A — Baseline",
  B_skip_active: "B — Skip active jumps",
  C_compress: "C — Compress prob",
  D_sigma_inflate: "D — σ inflate",
  E_larger_edge: "E — Larger edge",
};

function fmtPct(x: number, digits = 1) { return `${(x * 100).toFixed(digits)}%`; }
function fmtNum(x: number, digits = 3) { return Number.isFinite(x) ? x.toFixed(digits) : "—"; }
function fmtDollar(x: number) { return `${x >= 0 ? "" : "-"}$${Math.abs(x).toFixed(0)}`; }

export function JumpBacktestPanel() {
  const runFn = useServerFn(runJumpPolicyBacktest);
  const [days, setDays] = useState(7);

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["jump-backtest", days],
    queryFn: () => runFn({ data: {
      fromIso: new Date(Date.now() - days * 86400_000).toISOString(),
      toIso: new Date().toISOString(),
    }}),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const segments = data ? Array.from(new Set(data.results.map(r => r.segment))) : [];

  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-slate-100">
          <Zap className="h-4 w-4 text-amber-400" />
          Jump-Detection Policy Backtest (Phase 1B · read-only)
        </CardTitle>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1"
          >
            <option value={1}>Last 1d</option>
            <option value={3}>Last 3d</option>
            <option value={7}>Last 7d</option>
            <option value={14}>Last 14d</option>
            <option value={30}>Last 30d</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="text-slate-400 text-sm">Running backtest…</div>}
        {error && <div className="text-rose-400 text-sm">Error: {String(error)}</div>}
        {data && (
          <>
            <div className="text-xs text-slate-400 flex flex-wrap gap-4">
              <span>Total settled: <b className="text-slate-200">{data.totalRows}</b></span>
              <span>Eligible w/ jump features: <b className="text-slate-200">{data.eligibleRows}</b></span>
              <span>Unique 15m windows: <b className="text-slate-200">{data.windows}</b></span>
              <span>Fold split key: <code className="text-slate-300">{data.foldSplitKey}</code></span>
            </div>
            {data.eligibleRows === 0 && (
              <div className="text-sm text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded p-3">
                No settled predictions yet carry jump features. Ticks are being collected now; the panel will populate as new markets settle with ≥20 samples in the 30s window preceding the snapshot.
              </div>
            )}
            {data.eligibleRows > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="text-left py-2 px-2">Segment</th>
                      <th className="text-left py-2 px-2">Policy</th>
                      <th className="text-right py-2 px-2">N pred</th>
                      <th className="text-right py-2 px-2">N trades</th>
                      <th className="text-right py-2 px-2">Win%</th>
                      <th className="text-right py-2 px-2">Brier</th>
                      <th className="text-right py-2 px-2">LogLoss</th>
                      <th className="text-right py-2 px-2">ECE</th>
                      <th className="text-right py-2 px-2">P/L</th>
                      <th className="text-right py-2 px-2">ROC</th>
                      <th className="text-right py-2 px-2">Max DD</th>
                      <th className="text-right py-2 px-2">Streak</th>
                      <th className="text-right py-2 px-2">Δ P/L</th>
                      <th className="text-right py-2 px-2">Δ Brier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map(seg => (
                      <>
                        {data.results.filter(r => r.segment === seg).map((r, i) => (
                          <tr key={`${seg}-${r.policy}`} className={`border-b border-slate-800/60 ${i === 0 ? "bg-slate-800/40" : ""}`}>
                            {i === 0 && (
                              <td rowSpan={5} className="align-top py-2 px-2 font-semibold text-slate-200">{seg}</td>
                            )}
                            <td className="py-1.5 px-2 text-slate-300">{POLICY_LABEL[r.policy]}</td>
                            <td className="text-right py-1.5 px-2 text-slate-400">{r.n_predictions}</td>
                            <td className="text-right py-1.5 px-2 text-slate-200">{r.n_trades}</td>
                            <td className="text-right py-1.5 px-2 text-slate-200">{fmtPct(r.win_rate)}</td>
                            <td className="text-right py-1.5 px-2 text-slate-200">{fmtNum(r.brier)}</td>
                            <td className="text-right py-1.5 px-2 text-slate-400">{fmtNum(r.log_loss)}</td>
                            <td className="text-right py-1.5 px-2 text-slate-400">{fmtNum(r.ece)}</td>
                            <td className={`text-right py-1.5 px-2 ${r.pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtDollar(r.pnl_usd)}</td>
                            <td className="text-right py-1.5 px-2 text-slate-400">{fmtPct(r.roc_pct)}</td>
                            <td className="text-right py-1.5 px-2 text-slate-400">{fmtDollar(r.max_drawdown_usd)}</td>
                            <td className="text-right py-1.5 px-2 text-slate-400">{r.worst_losing_streak}</td>
                            <td className={`text-right py-1.5 px-2 ${r.delta_vs_baseline_pnl_usd > 0 ? "text-emerald-400" : r.delta_vs_baseline_pnl_usd < 0 ? "text-rose-400" : "text-slate-500"}`}>
                              {r.policy === "A_baseline" ? "—" : fmtDollar(r.delta_vs_baseline_pnl_usd)}
                            </td>
                            <td className={`text-right py-1.5 px-2 ${r.delta_vs_baseline_brier < 0 ? "text-emerald-400" : r.delta_vs_baseline_brier > 0 ? "text-rose-400" : "text-slate-500"}`}>
                              {r.policy === "A_baseline" ? "—" : fmtNum(r.delta_vs_baseline_brier, 4)}
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.perDay.length > 0 && (
              <details className="text-xs text-slate-300">
                <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Per-day walk-forward view (grouped by 15m market window)</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="text-left py-1 px-2">Day</th>
                        <th className="text-left py-1 px-2">Policy</th>
                        <th className="text-right py-1 px-2">N</th>
                        <th className="text-right py-1 px-2">Win%</th>
                        <th className="text-right py-1 px-2">Brier</th>
                        <th className="text-right py-1 px-2">P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perDay.map((r, i) => (
                        <tr key={i} className="border-b border-slate-800/40">
                          <td className="py-1 px-2 text-slate-300">{r.day}</td>
                          <td className="py-1 px-2 text-slate-400">{POLICY_LABEL[r.policy]}</td>
                          <td className="text-right py-1 px-2">{r.n_trades}</td>
                          <td className="text-right py-1 px-2">{fmtPct(r.win_rate)}</td>
                          <td className="text-right py-1 px-2">{fmtNum(r.brier)}</td>
                          <td className={`text-right py-1 px-2 ${r.pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtDollar(r.pnl_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <div className="text-[11px] text-slate-500 leading-relaxed">
              <b className="text-slate-400">Read-only:</b> This backtest does not touch live gates, stakes, exits, or applied calibration.
              Fold split key <code>ticker|strike|close_time</code> ensures every snapshot from one 15-minute contract stays in the same fold.
              Trade payoff assumes $100 flat stake at market ask; ROC = pnl / (n_trades × $100).
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
