import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runJumpPolicyBacktest } from "@/lib/jumpBacktest.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Loader2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";

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

type Light = "green" | "amber" | "red";
function ThresholdRow({ label, value, target, light }: { label: string; value: string; target: string; light: Light }) {
  const Icon = light === "green" ? CheckCircle2 : light === "amber" ? AlertCircle : XCircle;
  const color = light === "green" ? "text-emerald-400" : light === "amber" ? "text-amber-400" : "text-rose-400";
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-slate-800/40 last:border-0">
      <div className="flex items-center gap-2 text-slate-300 text-xs">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span>{label}</span>
      </div>
      <div className="text-xs text-slate-400">
        <span className={color}>{value}</span> <span className="text-slate-500">/ {target}</span>
      </div>
    </div>
  );
}

function lightFor(actual: number, target: number, minor = 0.5): Light {
  if (actual >= target) return "green";
  if (actual >= target * minor) return "amber";
  return "red";
}

function Chip({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const bg = tone === "emerald" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
    : tone === "amber" ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
    : tone === "rose" ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
    : "bg-slate-800/60 border-slate-700 text-slate-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${bg}`}>
      <span className="text-slate-400">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

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

  // Extract readiness counters from window-level "all" segment + segment-specific.
  const readiness = useMemo(() => {
    if (!data) return null;
    const findWindows = (seg: string) => data.results.find(r => r.segment === seg && r.policy === "A_baseline")?.n_windows_seen ?? 0;
    const findRows = (seg: string) => data.results.find(r => r.segment === seg && r.policy === "A_baseline")?.n_predictions ?? 0;
    const days = new Set(data.perDay.map(r => r.day)).size;
    return {
      totalSnaps: data.eligibleRows,
      totalWindows: data.windows,
      calendarDays: days,
      le30s_snaps: findRows("≤30s"),
      le30s_windows: findWindows("≤30s"),
      contested_snaps: findRows("contested"),
      contested_windows: findWindows("contested"),
    };
  }, [data]);

  const renderPolicyTable = (rows: typeof data extends undefined ? never : NonNullable<typeof data>["results"], title: string, key: string) => (
    <details className="text-xs text-slate-300" key={key}>
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200 py-1">{title}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-800">
              <th className="text-left py-1 px-2">Policy</th>
              <th className="text-right py-1 px-2">N pred</th>
              <th className="text-right py-1 px-2">Windows</th>
              <th className="text-right py-1 px-2">Trades</th>
              <th className="text-right py-1 px-2">Win%</th>
              <th className="text-right py-1 px-2">Brier</th>
              <th className="text-right py-1 px-2">P/L</th>
              <th className="text-right py-1 px-2">CI 95%</th>
              <th className="text-right py-1 px-2">Max DD</th>
              <th className="text-right py-1 px-2">Δ P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.segment}-${r.policy}`} className="border-b border-slate-800/40">
                <td className="py-1 px-2 text-slate-300">{POLICY_LABEL[r.policy]}</td>
                <td className="text-right py-1 px-2 text-slate-400">{r.n_predictions}</td>
                <td className="text-right py-1 px-2 text-slate-400">{r.n_windows_seen}</td>
                <td className="text-right py-1 px-2 text-slate-200">{r.n_trades}</td>
                <td className="text-right py-1 px-2 text-slate-200">{fmtPct(r.win_rate)}</td>
                <td className="text-right py-1 px-2 text-slate-400">{fmtNum(r.brier)}</td>
                <td className={`text-right py-1 px-2 ${r.pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtDollar(r.pnl_usd)}</td>
                <td className="text-right py-1 px-2 text-slate-500">
                  {r.pnl_ci_low_usd != null && r.pnl_ci_high_usd != null
                    ? `[${fmtDollar(r.pnl_ci_low_usd)}, ${fmtDollar(r.pnl_ci_high_usd)}]`
                    : "—"}
                </td>
                <td className="text-right py-1 px-2 text-slate-500">{fmtDollar(r.max_drawdown_usd)}</td>
                <td className={`text-right py-1 px-2 ${r.delta_vs_baseline_pnl_usd > 0 ? "text-emerald-400" : r.delta_vs_baseline_pnl_usd < 0 ? "text-rose-400" : "text-slate-500"}`}>
                  {r.policy === "A_baseline" ? "—" : fmtDollar(r.delta_vs_baseline_pnl_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );

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
        {data && readiness && (
          <>
            {/* Readiness section */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                <span>Readiness gates</span>
                <span className="text-[10px] text-slate-500 font-normal">window-level · fold split: <code className="text-slate-400">{data.foldSplitKey}</code></span>
              </div>
              <ThresholdRow
                label="Early directional read"
                value={`${readiness.totalSnaps} snaps · ${readiness.totalWindows} windows`}
                target="≥500 snaps · ≥50 windows"
                light={lightFor(Math.min(readiness.totalSnaps / 500, readiness.totalWindows / 50), 1)}
              />
              <ThresholdRow
                label="Serious policy comparison"
                value={`${readiness.totalSnaps} snaps · ${readiness.totalWindows} windows`}
                target="≥1500 snaps · ≥150 windows"
                light={lightFor(Math.min(readiness.totalSnaps / 1500, readiness.totalWindows / 150), 1)}
              />
              <ThresholdRow
                label="≤30s bucket"
                value={`${readiness.le30s_snaps} snaps · ${readiness.le30s_windows} windows`}
                target="≥100 snaps · ≥30 windows"
                light={lightFor(Math.min(readiness.le30s_snaps / 100, readiness.le30s_windows / 30), 1)}
              />
              <ThresholdRow
                label="Contested-strike bucket"
                value={`${readiness.contested_snaps} snaps · ${readiness.contested_windows} windows`}
                target="≥100 snaps · ≥30 windows"
                light={lightFor(Math.min(readiness.contested_snaps / 100, readiness.contested_windows / 30), 1)}
              />
              <ThresholdRow
                label="Calendar coverage"
                value={`${readiness.calendarDays} days`}
                target="≥5 days"
                light={lightFor(readiness.calendarDays, 5)}
              />
            </div>

            {/* Distribution chips */}
            <div className="flex flex-wrap gap-1.5">
              {["≤30s", "31-60s", "61-120s", ">120s"].map(seg => {
                const r = data.results.find(x => x.segment === seg && x.policy === "A_baseline");
                return r ? <Chip key={seg} label={seg} value={r.n_predictions} /> : null;
              })}
              <Chip label="contested" value={data.results.find(r => r.segment === "contested" && r.policy === "A_baseline")?.n_predictions ?? 0} tone="amber" />
              <Chip label="uncontested" value={data.results.find(r => r.segment === "uncontested" && r.policy === "A_baseline")?.n_predictions ?? 0} />
              <Chip label="YES" value={data.results.find(r => r.segment === "YES" && r.policy === "A_baseline")?.n_predictions ?? 0} />
              <Chip label="NO" value={data.results.find(r => r.segment === "NO" && r.policy === "A_baseline")?.n_predictions ?? 0} />
              <Chip label="primary" value={data.sourceSplit.counts.primary} tone="emerald" />
              <Chip label="fallback" value={data.sourceSplit.counts.fallback} tone="amber" />
              {data.sourceSplit.counts.unknown > 0 && <Chip label="unknown" value={data.sourceSplit.counts.unknown} tone="rose" />}
            </div>

            {data.eligibleRows === 0 && (
              <div className="text-sm text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded p-3">
                No settled predictions yet carry jump features. Ticks are being collected now; the panel will populate as new markets settle with ≥20 samples in the 30s window preceding the snapshot.
              </div>
            )}

            {data.eligibleRows > 0 && (
              <>
                {/* Primary window-level table by segment */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="text-left py-2 px-2">Segment</th>
                        <th className="text-left py-2 px-2">Policy</th>
                        <th className="text-right py-2 px-2">N pred</th>
                        <th className="text-right py-2 px-2">Windows</th>
                        <th className="text-right py-2 px-2">Trades</th>
                        <th className="text-right py-2 px-2">Win%</th>
                        <th className="text-right py-2 px-2">Brier</th>
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
                              <td className="text-right py-1.5 px-2 text-slate-400">{r.n_windows_seen}</td>
                              <td className="text-right py-1.5 px-2 text-slate-200">{r.n_trades}</td>
                              <td className="text-right py-1.5 px-2 text-slate-200">{fmtPct(r.win_rate)}</td>
                              <td className="text-right py-1.5 px-2 text-slate-400">{fmtNum(r.brier)}</td>
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

                {/* Source split */}
                {(data.sourceSplit.primary.length > 0 || data.sourceSplit.fallback.length > 0) && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-300">Source split (window-level)</div>
                    {data.sourceSplit.primary.length > 0 && renderPolicyTable(data.sourceSplit.primary, `Primary buffer only · ${data.sourceSplit.counts.primary} rows`, "src-primary")}
                    {data.sourceSplit.fallback.length > 0 && renderPolicyTable(data.sourceSplit.fallback, `Odds-tape fallback only · ${data.sourceSplit.counts.fallback} rows`, "src-fallback")}
                    {data.sourceSplit.combined.length > 0 && renderPolicyTable(data.sourceSplit.combined, `Combined · ${data.eligibleRows} rows`, "src-combined")}
                  </div>
                )}

                {/* 88%+ confidence pocket */}
                {data.pocket88.length > 0 && renderPolicyTable(data.pocket88, `High-confidence pocket (modelProb ≥ 0.88 or ≤ 0.12)`, "pocket-88")}

                {/* Walk-forward */}
                {data.walkForward.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-300">Walk-forward split</div>
                    {data.walkForward.map(slice => (
                      renderPolicyTable(slice.results, `${slice.label} · ${slice.days.length} day(s)`, `wf-${slice.label}`)
                    ))}
                  </div>
                )}

                {/* Per-day view */}
                {data.perDay.length > 0 && (
                  <details className="text-xs text-slate-300">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Per-day walk-forward (window-level)</summary>
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
              </>
            )}

            <div className="text-[11px] text-slate-500 leading-relaxed">
              <b className="text-slate-400">Read-only:</b> This backtest does not touch live gates, stakes, exits, or applied calibration.
              Primary table is window-level: per policy, per 15m contract, the first eligible snapshot under that policy is traded. Bootstrap 95% CI resamples by window.
              Trade payoff assumes $100 flat stake at market ask; ROC = pnl / (n_trades × $100).
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
