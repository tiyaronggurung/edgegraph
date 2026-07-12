// Shadow-only conviction-decay exit study. READ-ONLY — never mutates exits.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getConvictionExitStudy,
  backfillConvictionExitOutcomes,
} from "@/lib/convictionExitStudy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";

function fmt$(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}$${n.toFixed(d)}`;
}
function fmtPct(n: number | null | undefined, d = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}

export function ConvictionExitPanel() {
  const qc = useQueryClient();
  const getStudy = useServerFn(getConvictionExitStudy);
  const backfill = useServerFn(backfillConvictionExitOutcomes);

  const q = useQuery({
    queryKey: ["conviction-exit-study"],
    queryFn: () => getStudy(),
    staleTime: 60_000,
  });
  const bf = useMutation({
    mutationFn: () => backfill(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conviction-exit-study"] }),
  });

  const s = q.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">
            Conviction-Decay Exit — shadow study{" "}
            <Badge variant="outline" className="ml-2">read-only</Badge>
          </CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            "would_exit" fires when <code>entry_prob − current_prob ≥ T</code> AND
            <code> current_prob ∈ [0.48, 0.55]</code>. No live exit reads these numbers.
            Model-auto odds-bet trades only.
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
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Readiness gates — no promotion until all pass
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <Gate label="Trades ≥200" have={s.readiness.min_trades.have} need={s.readiness.min_trades.need} ok={s.readiness.min_trades.ok} />
                <Gate label="Days ≥5" have={s.readiness.min_days.have} need={s.readiness.min_days.need} ok={s.readiness.min_days.ok} />
                {Object.entries(s.readiness.per_threshold).map(([thr, v]) => (
                  <Gate key={thr} label={`Fired ≥30 (${thr})`} have={v.fired} need={30} ok={v.ok} />
                ))}
              </div>
              <div className="text-xs">
                {s.readiness.all_gates_pass
                  ? <span className="text-green-500 font-semibold">All gates pass — review, but do not auto-promote.</span>
                  : <span className="text-amber-500">Some gates still open. Keep collecting.</span>}
                {" · "}
                <span className="text-muted-foreground">
                  {s.trades_touched} settled trades · {s.day_count} days · {s.total_shadow_rows} shadow rows
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1">drop thr</th>
                    <th className="text-right">fired / touched</th>
                    <th className="text-right">fire rate</th>
                    <th className="text-right">avoided $L</th>
                    <th className="text-right">forfeited $W</th>
                    <th className="text-right">net effect</th>
                    <th className="text-right">hold P/L</th>
                    <th className="text-right">hypo P/L</th>
                    <th className="text-right">Δ (hypo−hold)</th>
                    <th className="text-right">retention</th>
                  </tr>
                </thead>
                <tbody>
                  {s.by_threshold.map(t => (
                    <tr key={t.thr} className="border-b border-muted/40">
                      <td className="py-1 font-mono">0.{t.thr}</td>
                      <td className="text-right">{t.fired}/{t.trades_touched}</td>
                      <td className="text-right">{fmtPct(t.fire_rate_pct)}</td>
                      <td className="text-right text-green-500">{fmt$(t.avoided_loss_dollars)}</td>
                      <td className="text-right text-amber-500">{fmt$(t.forfeited_win_dollars)}</td>
                      <td className={`text-right font-semibold ${t.net_effect >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(t.net_effect)}</td>
                      <td className={`text-right ${t.hold_pnl_total >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(t.hold_pnl_total)}</td>
                      <td className={`text-right ${t.hypo_pnl_total >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(t.hypo_pnl_total)}</td>
                      <td className={`text-right font-semibold ${t.delta_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(t.delta_pnl)}</td>
                      <td className="text-right">{fmtPct(t.trade_retention_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Tabs defaultValue="010">
              <TabsList>
                {s.by_threshold.map(t => (
                  <TabsTrigger key={t.thr} value={t.thr}>drop 0.{t.thr}</TabsTrigger>
                ))}
              </TabsList>
              {s.by_threshold.map(t => (
                <TabsContent key={t.thr} value={t.thr} className="space-y-3">
                  <SplitTable title="By side" rows={(s.by_side[t.thr] ?? []).map(r => [r.side, r.fired, r.avoided_loss, r.forfeited_win, r.net])} />
                  <SplitTable title="By time-to-close" rows={(s.by_time_bucket[t.thr] ?? []).map(r => [r.bucket, r.fired, r.avoided_loss, r.forfeited_win, r.net])} />
                  <SplitTable title="By entry ask band" rows={(s.by_ask[t.thr] ?? []).map(r => [r.band, r.fired, r.avoided_loss, r.forfeited_win, r.net])} />
                  <SplitTable title="By day" rows={(s.by_day[t.thr] ?? []).map(r => [r.day, r.fired, r.avoided_loss, r.forfeited_win, r.net])} />
                </TabsContent>
              ))}
            </Tabs>
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

function SplitTable(p: { title: string; rows: Array<[string, number, number, number, number]> }) {
  if (p.rows.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{p.title}</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="text-left py-1">key</th>
            <th className="text-right">fired</th>
            <th className="text-right">avoided $L</th>
            <th className="text-right">forfeited $W</th>
            <th className="text-right">net</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map(r => (
            <tr key={r[0]} className="border-b border-muted/40">
              <td className="py-1">{r[0]}</td>
              <td className="text-right">{r[1]}</td>
              <td className="text-right text-green-500">{fmt$(r[2])}</td>
              <td className="text-right text-amber-500">{fmt$(r[3])}</td>
              <td className={`text-right font-semibold ${r[4] >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(r[4])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
