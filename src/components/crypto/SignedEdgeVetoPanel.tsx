// Shadow-only comparison panel for the signed-edge veto policies (0.03 / 0.05
// / 0.08). READ-ONLY: never changes any gate, never suggests promotion until
// readiness gates all pass. Mirrors the JumpBacktestPanel style.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSignedEdgeVetoStudy,
  backfillDecisionLogOutcomes,
} from "@/lib/signedEdgeVetoStudy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";

function fmt$(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toFixed(d);
  return `${n >= 0 ? "+" : ""}$${s}`;
}
function fmtPct(n: number | null | undefined, d = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}
function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

export function SignedEdgeVetoPanel() {
  const qc = useQueryClient();
  const getStudy = useServerFn(getSignedEdgeVetoStudy);
  const backfill = useServerFn(backfillDecisionLogOutcomes);

  const q = useQuery({
    queryKey: ["signed-edge-veto-study"],
    queryFn: () => getStudy(),
    staleTime: 60_000,
  });

  const bf = useMutation({
    mutationFn: () => backfill(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signed-edge-veto-study"] }),
  });

  const s = q.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">
            Signed-Edge Veto — shadow study{" "}
            <Badge variant="outline" className="ml-2">read-only</Badge>
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            Compares would-skip flags against unchanged baseline. No live gate reads these numbers.
            Formula: <code>signed_edge = model_side_prob − entry_ask_prob</code>.
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => bf.mutate()} disabled={bf.isPending}>
            <RefreshCw className={`h-3 w-3 mr-1 ${bf.isPending ? "animate-spin" : ""}`} />
            Backfill outcomes
          </Button>
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!s && <div className="text-sm text-muted-foreground">Loading…</div>}
        {s && (
          <>
            {/* Readiness gates */}
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Readiness gates — no promotion until all pass
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <Gate label="Windows ≥200" have={s.readiness.min_windows.have} need={s.readiness.min_windows.need} ok={s.readiness.min_windows.ok} />
                <Gate label="Days ≥7" have={s.readiness.min_days.have} need={s.readiness.min_days.need} ok={s.readiness.min_days.ok} />
                {Object.entries(s.readiness.per_threshold).map(([thr, v]) => (
                  <Gate key={thr} label={`Vetoed ≥30 (${thr})`} have={v.vetoed_windows} need={30} ok={v.ok} />
                ))}
              </div>
              <div className="text-xs">
                {s.readiness.all_gates_pass
                  ? <span className="text-green-500 font-semibold">All gates pass — review, but do not auto-promote.</span>
                  : <span className="text-amber-500">Some gates still open. Keep collecting.</span>}
                {" · "}
                <span className="text-muted-foreground">
                  {s.window_count} windows · {s.day_count} days · {s.total_rows} decision rows
                </span>
              </div>
            </div>

            {/* Per-threshold summary */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1">thr</th>
                    <th className="text-right">kept</th>
                    <th className="text-right">vetoed W/L</th>
                    <th className="text-right">avoided $W</th>
                    <th className="text-right">avoided $L</th>
                    <th className="text-right">kept P/L</th>
                    <th className="text-right">Δ vs base</th>
                    <th className="text-right">P/L per trade</th>
                    <th className="text-right">ROC</th>
                    <th className="text-right">PF</th>
                    <th className="text-right">max DD</th>
                    <th className="text-right">worst streak</th>
                    <th className="text-right">retention</th>
                  </tr>
                </thead>
                <tbody>
                  {s.by_threshold.map(t => (
                    <tr key={t.thr} className="border-b border-muted/40">
                      <td className="py-1 font-mono">{t.thr}</td>
                      <td className="text-right">{t.kept}/{t.windows}</td>
                      <td className="text-right">{t.vetoed_wins}/{t.vetoed_losses}</td>
                      <td className="text-right text-amber-500">{fmt$(t.avoided_win_dollars)}</td>
                      <td className="text-right text-green-500">{fmt$(t.avoided_loss_dollars)}</td>
                      <td className={`text-right ${t.kept_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(t.kept_pnl)}</td>
                      <td className={`text-right font-semibold ${t.delta_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(t.delta_pnl)}</td>
                      <td className="text-right">{fmt$(t.pnl_per_trade)}</td>
                      <td className="text-right">{fmtPct(t.roc_pct)}</td>
                      <td className="text-right">{t.profit_factor == null ? "—" : (t.profit_factor === Infinity ? "∞" : fmtNum(t.profit_factor))}</td>
                      <td className="text-right text-red-500">{fmt$(t.max_drawdown)}</td>
                      <td className="text-right">{t.worst_losing_streak}</td>
                      <td className="text-right">{fmtPct(t.trade_retention_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-1">
                Baseline (unchanged odds-band path): {fmt$(s.by_threshold[0]?.baseline_pnl ?? 0)} across {s.window_count} windows.
              </div>
            </div>

            {/* Splits per threshold */}
            <Tabs defaultValue="0.03">
              <TabsList>
                {s.by_threshold.map(t => (
                  <TabsTrigger key={t.thr} value={String(t.thr)}>thr {t.thr}</TabsTrigger>
                ))}
              </TabsList>
              {s.by_threshold.map(t => {
                const key = String(t.thr);
                return (
                  <TabsContent key={key} value={key} className="space-y-3">
                    <SplitTable title="By day" rows={(s.by_day[key] ?? []).map(d => [d.day, d.kept, d.vetoed, d.baseline_pnl, d.kept_pnl, d.delta])} />
                    <SplitTable title="By side" rows={(s.by_side[key] ?? []).map(d => [d.side, d.kept, d.vetoed, d.baseline_pnl, d.kept_pnl, d.kept_pnl - d.baseline_pnl])} />
                    <SplitTable title="By ask band" rows={(s.by_ask[key] ?? []).map(d => [d.band, d.kept, d.vetoed, d.baseline_pnl, d.kept_pnl, d.kept_pnl - d.baseline_pnl])} />
                    <SplitTable title="By time-to-close" rows={(s.by_time_bucket[key] ?? []).map(d => [d.bucket, d.kept, d.vetoed, d.baseline_pnl, d.kept_pnl, d.kept_pnl - d.baseline_pnl])} />
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">Model calibration — kept vs vetoed</div>
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground border-b">
                          <tr><th className="text-left">group</th><th className="text-right">n</th><th className="text-right">avg model prob</th><th className="text-right">win rate</th></tr>
                        </thead>
                        <tbody>
                          {(s.calibration[key] ?? []).map(c => (
                            <tr key={c.group} className="border-b border-muted/40">
                              <td className="py-1">{c.group}</td>
                              <td className="text-right">{c.n}</td>
                              <td className="text-right">{fmtNum(c.avg_model_prob, 3)}</td>
                              <td className="text-right">{fmtPct(c.win_rate * 100)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>

            <div className="rounded border p-2 text-xs">
              <span className="text-muted-foreground">Actual live-entered slice: </span>
              <span className="font-mono">
                {s.actual_slice.entered} entered · {s.actual_slice.wins} wins · realized {fmt$(s.actual_slice.realized_pnl_usd)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Gate(p: { label: string; have: number; need: number; ok: boolean }) {
  return (
    <div className={`rounded px-2 py-1 border ${p.ok ? "border-green-500/40 text-green-500" : "border-amber-500/40 text-amber-500"}`}>
      <div className="text-[10px] uppercase opacity-70">{p.label}</div>
      <div className="font-mono">{p.have} / {p.need}</div>
    </div>
  );
}

function SplitTable(p: { title: string; rows: Array<[string, number, number, number, number, number]> }) {
  if (p.rows.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{p.title}</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="text-left py-1">key</th>
            <th className="text-right">kept</th>
            <th className="text-right">vetoed</th>
            <th className="text-right">baseline P/L</th>
            <th className="text-right">kept P/L</th>
            <th className="text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map(r => (
            <tr key={r[0]} className="border-b border-muted/40">
              <td className="py-1">{r[0]}</td>
              <td className="text-right">{r[1]}</td>
              <td className="text-right">{r[2]}</td>
              <td className={`text-right ${r[3] >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(r[3])}</td>
              <td className={`text-right ${r[4] >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(r[4])}</td>
              <td className={`text-right font-semibold ${r[5] >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(r[5])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
