import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  runOddsStudy, getLatestOddsStudy, applyTuning, revertTuning,
  setAutoApplyStudies, listTuningAudit,
} from "@/lib/oddsStudy.functions";

// Odds Study Panel
// - Live aggregates from auto_odds_study_log (flip rate, alignment, buckets)
// - Latest AI study card (summary, findings, pending tunings)
// - Auto-apply toggle (opt-in) — AI-confidence ≥ 0.7 tunings apply on next cron
// - Tuning audit log with revert

interface LogRow {
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
  const qc = useQueryClient();
  const runFn = useServerFn(runOddsStudy);
  const latestFn = useServerFn(getLatestOddsStudy);
  const applyFn = useServerFn(applyTuning);
  const revertFn = useServerFn(revertTuning);
  const setAutoFn = useServerFn(setAutoApplyStudies);
  const auditFn = useServerFn(listTuningAudit);

  const rowsQ = useQuery({
    queryKey: ["odds-study-log"],
    queryFn: async (): Promise<LogRow[]> => {
      const { data, error } = await supabase
        .from("auto_odds_study_log")
        .select("ticker, seconds_to_close, spot, yes_cents, no_cents, picked_side, model_side_prob, entered, hedge_fired, prior_yes_cents, yes_cents_delta, spot_delta, seconds_since_prior, crossed_50, time_bucket, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
    refetchInterval: 30_000,
  });

  const settingsQ = useQuery({
    queryKey: ["auto-odds-settings-tune"],
    queryFn: async () => {
      const { data } = await supabase
        .from("auto_odds_settings")
        .select("auto_apply_studies, model_gate_min, hedge_band_lo, hedge_band_hi, tp_cents, oscillation_max, skip_bucket_lt15s, skip_bucket_15_60s")
        .maybeSingle();
      return data;
    },
    refetchInterval: 60_000,
  });

  const studyQ = useQuery({ queryKey: ["odds-study-latest"], queryFn: () => latestFn(), refetchInterval: 60_000 });
  const auditQ = useQuery({ queryKey: ["odds-study-audit"], queryFn: () => auditFn(), refetchInterval: 60_000 });

  const runMut = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success(`Study complete — ${r.applied ?? 0} tunings applied`);
        qc.invalidateQueries({ queryKey: ["odds-study-latest"] });
        qc.invalidateQueries({ queryKey: ["odds-study-audit"] });
        qc.invalidateQueries({ queryKey: ["auto-odds-settings-tune"] });
      } else toast.error(r?.error ?? r?.reason ?? "Study failed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Study failed"),
  });

  const applyMut = useMutation({
    mutationFn: (v: { studyId: string; param: string }) => applyFn({ data: v }),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success("Applied");
        qc.invalidateQueries({ queryKey: ["odds-study-latest"] });
        qc.invalidateQueries({ queryKey: ["odds-study-audit"] });
        qc.invalidateQueries({ queryKey: ["auto-odds-settings-tune"] });
      } else toast.error(r?.error ?? "Apply failed");
    },
  });

  const revertMut = useMutation({
    mutationFn: (v: { auditId: string }) => revertFn({ data: v }),
    onSuccess: () => {
      toast.success("Reverted");
      qc.invalidateQueries({ queryKey: ["odds-study-audit"] });
      qc.invalidateQueries({ queryKey: ["auto-odds-settings-tune"] });
    },
  });

  const autoMut = useMutation({
    mutationFn: (v: { enabled: boolean }) => setAutoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auto-odds-settings-tune"] }),
  });

  const stats = useMemo(() => {
    const rows = rowsQ.data ?? [];
    const withPrior = rows.filter(r => r.prior_yes_cents != null && r.yes_cents_delta != null);
    const flips = withPrior.filter(r => r.crossed_50).length;
    const avgAbsCentDelta = withPrior.length
      ? withPrior.reduce((s, r) => s + Math.abs(r.yes_cents_delta as number), 0) / withPrior.length : 0;
    const withSpot = withPrior.filter(r => r.spot_delta != null);
    const avgAbsSpotDelta = withSpot.length
      ? withSpot.reduce((s, r) => s + Math.abs(r.spot_delta as number), 0) / withSpot.length : 0;
    const signed = withSpot.filter(r => Math.abs(r.spot_delta as number) > 5 && Math.abs(r.yes_cents_delta as number) >= 1);
    const aligned = signed.filter(r => Math.sign(r.spot_delta as number) === Math.sign(r.yes_cents_delta as number)).length;
    const alignRate = signed.length ? aligned / signed.length : null;
    const byBucket = BUCKETS.map(b => {
      const bucket = rows.filter(r => r.time_bucket === b);
      const bWithPrior = bucket.filter(r => r.yes_cents_delta != null);
      const bFlips = bucket.filter(r => r.crossed_50).length;
      const bEntered = bucket.filter(r => r.entered).length;
      const bAvgSwing = bWithPrior.length
        ? bWithPrior.reduce((s, r) => s + Math.abs(r.yes_cents_delta as number), 0) / bWithPrior.length : 0;
      return { bucket: b, count: bucket.length, flips: bFlips,
        flipRate: bucket.length ? bFlips / bucket.length : 0, avgSwing: bAvgSwing,
        entered: bEntered, enteredRate: bucket.length ? bEntered / bucket.length : 0 };
    });
    return { total: rows.length, flips, avgAbsCentDelta, avgAbsSpotDelta, alignRate, byBucket };
  }, [rowsQ.data]);

  const study = (studyQ.data as any)?.study ?? null;
  const audit = (auditQ.data as any)?.rows ?? [];
  const autoApply = settingsQ.data?.auto_apply_studies ?? false;

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Odds Study — price ↔ odds ↔ time</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={autoApply}
              onChange={(e) => autoMut.mutate({ enabled: e.target.checked })}
              className="accent-primary" />
            <span>Auto-apply AI tunings (confidence ≥ 70%, safe range only)</span>
          </label>
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="text-xs px-3 py-1 border border-border rounded hover:bg-accent disabled:opacity-50"
          >
            {runMut.isPending ? "Studying…" : "Run AI Study"}
          </button>
        </div>
      </div>

      {rowsQ.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : stats.total === 0 ? (
        <div className="text-xs text-muted-foreground">No snapshots yet. Rows are written every tick an auto-odds candidate is evaluated.</div>
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
        </>
      )}

      {/* Current live tunable values */}
      {settingsQ.data && (
        <div>
          <div className="text-[11px] uppercase text-muted-foreground mb-1">Live tunable values</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {[
              ["model_gate_min", settingsQ.data.model_gate_min ?? 0.60],
              ["hedge_band_lo", settingsQ.data.hedge_band_lo ?? 0.60],
              ["hedge_band_hi", settingsQ.data.hedge_band_hi ?? 0.68],
              ["tp_cents", settingsQ.data.tp_cents ?? 98],
              ["oscillation_max", settingsQ.data.oscillation_max ?? 3],
              ["skip_bucket_lt15s", settingsQ.data.skip_bucket_lt15s ?? false],
              ["skip_bucket_15_60s", settingsQ.data.skip_bucket_15_60s ?? false],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded border border-border/50 px-2 py-1">
                <div className="text-muted-foreground text-[10px] font-mono">{String(k)}</div>
                <div className="font-mono">{String(v)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest AI study */}
      {study && (
        <div className="border border-primary/30 bg-primary/5 rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase text-muted-foreground">Latest AI study</div>
            <div className="text-[10px] text-muted-foreground">{new Date(study.created_at).toLocaleString()} · {study.rows_analyzed} rows · {study.model}</div>
          </div>
          {study.summary && <div className="text-xs">{study.summary}</div>}
          {study.findings?.flip_zones?.length ? (
            <div className="text-[11px]"><span className="text-muted-foreground">Flip zones:</span> {study.findings.flip_zones.join(" · ")}</div>
          ) : null}
          {study.findings?.price_odds_relationship ? (
            <div className="text-[11px]"><span className="text-muted-foreground">Price↔odds:</span> {study.findings.price_odds_relationship}</div>
          ) : null}
          {Array.isArray(study.tunings) && study.tunings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-muted-foreground">Pending tunings</div>
              {study.tunings.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs bg-background/60 rounded px-2 py-1">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono">{t.param}</span>
                    <span className="text-muted-foreground"> {String(t.current)} → </span>
                    <span className="font-semibold">{String(t.suggested)}</span>
                    {typeof t.confidence === "number" && <span className="text-muted-foreground text-[10px]"> · conf {(t.confidence*100).toFixed(0)}%</span>}
                    {t.rationale && <div className="text-[10px] text-muted-foreground truncate">{t.rationale}</div>}
                    {t.rejected && <div className="text-[10px] text-destructive">rejected: {t.rejected}</div>}
                  </div>
                  {!t.rejected && (
                    <button
                      onClick={() => applyMut.mutate({ studyId: study.id, param: t.param })}
                      disabled={applyMut.isPending}
                      className="text-[11px] px-2 py-0.5 border border-border rounded hover:bg-accent disabled:opacity-50"
                    >Apply</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {Array.isArray(study.applied_tunings) && study.applied_tunings.length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              Applied this study: {study.applied_tunings.map((t: any) => `${t.param}=${t.suggested}`).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Tuning audit log */}
      {audit.length > 0 && (
        <div>
          <div className="text-[11px] uppercase text-muted-foreground mb-1">Tuning history (last 20)</div>
          <div className="space-y-1">
            {audit.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-[11px] border-b border-border/50 py-1">
                <div className="flex-1 min-w-0">
                  <span className="font-mono">{a.param}</span>
                  <span className="text-muted-foreground"> {JSON.stringify(a.prev_value)} → </span>
                  <span className="font-semibold">{JSON.stringify(a.new_value)}</span>
                  <span className="text-muted-foreground text-[10px]"> · {a.source} · {new Date(a.created_at).toLocaleString()}</span>
                  {a.reverted_at && <span className="text-destructive text-[10px]"> · reverted {new Date(a.reverted_at).toLocaleString()}</span>}
                </div>
                {!a.reverted_at && (
                  <button
                    onClick={() => revertMut.mutate({ auditId: a.id })}
                    disabled={revertMut.isPending}
                    className="text-[11px] px-2 py-0.5 border border-border rounded hover:bg-accent disabled:opacity-50"
                  >Revert</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground leading-snug">
        AI can only adjust: <span className="font-mono">model_gate_min</span> (0.55–0.75), <span className="font-mono">hedge_band</span>, <span className="font-mono">tp_cents</span> (95–99), <span className="font-mono">oscillation_max</span> (2–5), and bucket-skip flags — all within hardcoded safe ranges. Loss caps, entry size ($100), hedge size ($5), and the -450/-750 entry band are <strong>never</strong> tunable.
      </div>
    </div>
  );
}
