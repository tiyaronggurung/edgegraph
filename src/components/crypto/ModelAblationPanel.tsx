// Read-only ablation report panel. Renders the output of getModelAblation:
// per-variant Brier / log loss / hit rate / $10-flat P/L + calibration and
// per-time / per-sigma / per-side breakdowns. Isotonic fit table below.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getModelAblation, type AblationResult, type AblationVariantRow } from "@/lib/modelAblation.functions";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const num = (n: number, d = 4) => n.toFixed(d);
const usd = (n: number) => `${n >= 0 ? "+" : ""}$${n.toFixed(0)}`;

function VariantRow({ v, selected, onSelect }: { v: AblationVariantRow; selected: boolean; onSelect: () => void }) {
  return (
    <tr
      onClick={onSelect}
      className={`border-t border-border/60 cursor-pointer ${selected ? "bg-muted/40" : "hover:bg-muted/20"}`}
    >
      <td className="px-2 py-1">{v.label}</td>
      <td className="px-2 py-1 text-right">{v.nEligible}</td>
      <td className="px-2 py-1 text-right">{num(v.brier)}</td>
      <td className="px-2 py-1 text-right">{num(v.logLoss)}</td>
      <td className="px-2 py-1 text-right">{pct(v.hitRate, 1)}</td>
      <td className="px-2 py-1 text-right">{pct(v.avgPredicted, 1)}</td>
      <td className={`px-2 py-1 text-right ${v.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>{usd(v.pnlUsd)}</td>
      <td className="px-2 py-1 text-right text-red-400">{usd(v.maxDrawdownUsd)}</td>
    </tr>
  );
}

function DetailTable({ title, rows }: { title: string; rows: Array<{ key: string; n: number; brier?: number; hitRate?: number; predicted?: number; actual?: number }> }) {
  if (!rows.length) return null;
  const hasBrier = rows[0].brier != null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">Bucket</th>
              <th className="px-2 py-1 text-right">N</th>
              {hasBrier ? <th className="px-2 py-1 text-right">Brier</th> : <th className="px-2 py-1 text-right">Predicted</th>}
              {hasBrier ? <th className="px-2 py-1 text-right">Hit</th> : <th className="px-2 py-1 text-right">Actual</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="px-2 py-1 font-mono">{r.key}</td>
                <td className="px-2 py-1 text-right">{r.n}</td>
                <td className="px-2 py-1 text-right">
                  {hasBrier ? num(r.brier as number) : pct(r.predicted as number, 1)}
                </td>
                <td className="px-2 py-1 text-right">
                  {hasBrier ? pct(r.hitRate as number, 1) : pct(r.actual as number, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ModelAblationPanel() {
  const fn = useServerFn(getModelAblation);
  const [selected, setSelected] = useState<string>("model");
  const q = useQuery<AblationResult>({
    queryKey: ["model-ablation"],
    queryFn: () => fn(),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const active = q.data?.variants.find(v => v.key === selected) ?? q.data?.variants[0];

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">Model ablation report</div>
          <div className="text-xs text-muted-foreground">
            Compare model variants on <span className="font-mono">unseen</span> settled windows (walk-forward split by ticker, oldest 70% train / newest 30% test). Click a row to see its calibration and breakdowns.
          </div>
        </div>
        <button
          type="button"
          onClick={() => q.refetch()}
          className="p-1.5 rounded hover:bg-muted"
          aria-label="Refresh ablation"
        >
          <RefreshCw className={`w-4 h-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.isError && <div className="text-sm text-red-400">Failed to load ablation report.</div>}

      {q.data && q.data.testCount === 0 && (
        <div className="text-sm text-muted-foreground">Need more settled windows before an unseen-fold split is possible.</div>
      )}

      {q.data && q.data.testCount > 0 && (
        <>
          <div className="text-xs text-muted-foreground">
            {q.data.windowCount} markets · {q.data.trainCount} train snapshots · <span className="font-semibold text-foreground">{q.data.testCount} unseen test snapshots</span>
          </div>

          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left">Variant</th>
                  <th className="px-2 py-1 text-right">N</th>
                  <th className="px-2 py-1 text-right">Brier ↓</th>
                  <th className="px-2 py-1 text-right">Log loss ↓</th>
                  <th className="px-2 py-1 text-right">Hit</th>
                  <th className="px-2 py-1 text-right">Avg p</th>
                  <th className="px-2 py-1 text-right">P/L $10</th>
                  <th className="px-2 py-1 text-right">Max DD</th>
                </tr>
              </thead>
              <tbody>
                {q.data.variants.map(v => (
                  <VariantRow key={v.key} v={v} selected={v.key === selected} onSelect={() => setSelected(v.key)} />
                ))}
              </tbody>
            </table>
          </div>

          {active && active.nEligible > 0 && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Detail: <span className="text-foreground font-semibold">{active.label}</span> · n={active.nEligible}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <DetailTable title="Calibration by band" rows={active.calibration.map(c => ({ key: c.band, n: c.n, predicted: c.predicted, actual: c.actual }))} />
                <DetailTable title="By time-to-close" rows={active.byTime} />
                <DetailTable title="By distance (σ)" rows={active.bySigma} />
                <DetailTable title="By side" rows={active.bySide} />
              </div>
            </div>
          )}

          {q.data.isotonicFits.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Isotonic fits (latest per scope)</div>
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Scope</th>
                      <th className="px-2 py-1 text-left">Bucket</th>
                      <th className="px-2 py-1 text-right">N train</th>
                      <th className="px-2 py-1 text-right">N test</th>
                      <th className="px-2 py-1 text-right">Brier (test)</th>
                      <th className="px-2 py-1 text-right">Log loss (test)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.isotonicFits.map((f, i) => (
                      <tr key={`${f.scope}-${f.timeBucket ?? ""}-${i}`} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono">{f.scope}</td>
                        <td className="px-2 py-1 font-mono">{f.timeBucket ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{f.nTrain}</td>
                        <td className="px-2 py-1 text-right">{f.nTest}</td>
                        <td className="px-2 py-1 text-right">{f.brierTest != null ? num(f.brierTest) : "—"}</td>
                        <td className="px-2 py-1 text-right">{f.loglossTest != null ? num(f.loglossTest) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Fitted nightly by the calibration cron. Nothing is applied to the live gates yet — this table just tracks whether isotonic beats the current Platt calibrator on unseen data.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
