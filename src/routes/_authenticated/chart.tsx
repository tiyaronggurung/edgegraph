import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useBinanceBtcTicks } from "@/hooks/useBinanceBtcTicks";
import { useTrendlineAnalysis } from "@/hooks/useTrendlineAnalysis";
import { useCandleMomentum } from "@/hooks/useCandleMomentum";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { diagnoseRecentMisses, listRecentMisses, studyMissesWithAI, getLatestStudy, setRecommendationFeedback } from "@/lib/cryptoMisses.functions";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/chart")({
  head: () => ({
    meta: [
      { title: "BTC Chart — Trendlines & Fibonacci" },
      { name: "description", content: "Live BTC 1m chart with auto-drawn trendlines and Fibonacci retracement, plus a predicted up/down bias for the next 15-minute window." },
    ],
  }),
  component: ChartPage,
});

const W = 1200;
const H = 620;
const PAD = { top: 20, right: 90, bottom: 30, left: 10 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function ChartPage() {
  const { ticks, connected } = useBinanceBtcTicks();
  const a = useTrendlineAnalysis();
  const [showFib, setShowFib] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const cm = useCandleMomentum();

  // Auto-backtest wrong predictions: refresh diagnoses periodically + list misses.
  const diagnoseFn = useServerFn(diagnoseRecentMisses);
  const listFn = useServerFn(listRecentMisses);
  const qc = useQueryClient();
  const missesQ = useQuery({
    queryKey: ["crypto-misses"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });
  const diag = useMutation({
    mutationFn: () => diagnoseFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crypto-misses"] }),
  });

  // AI study loop — analyze misses and propose improvements.
  const studyFn = useServerFn(studyMissesWithAI);
  const latestStudyFn = useServerFn(getLatestStudy);
  const studyQ = useQuery({
    queryKey: ["crypto-latest-study"],
    queryFn: () => latestStudyFn(),
    refetchInterval: 60_000,
  });
  const runStudy = useMutation({
    mutationFn: () => studyFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crypto-latest-study"] }),
  });
  // Auto-run when the server flags enough new misses have accumulated.
  useEffect(() => {
    if (studyQ.data?.needsRun && !runStudy.isPending) {
      runStudy.mutate();
    }
  }, [studyQ.data?.needsRun]);

  // Recommendation feedback (👍 / 👎).
  const feedbackFn = useServerFn(setRecommendationFeedback);
  const feedbackMut = useMutation({
    mutationFn: (v: { studyId: string; recIndex: number; vote: "up" | "down" | null; recGate?: string; recSuggested?: string }) =>
      feedbackFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crypto-latest-study"] }),
  });


  const scale = useMemo(() => {
    const c = a.candles;
    if (c.length < 2) return null;
    const t0 = c[0].t;
    const t1 = c[c.length - 1].t + 60_000; // extend one bar to the right
    let ymin = Infinity, ymax = -Infinity;
    for (const k of c) { if (k.l < ymin) ymin = k.l; if (k.h > ymax) ymax = k.h; }
    if (a.fib) {
      for (const l of a.fib.levels) { if (l.price < ymin) ymin = l.price; if (l.price > ymax) ymax = l.price; }
    }
    const pad = (ymax - ymin) * 0.08 || 10;
    ymin -= pad; ymax += pad;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * PLOT_W;
    const y = (p: number) => PAD.top + (1 - (p - ymin) / (ymax - ymin)) * PLOT_H;
    return { x, y, ymin, ymax, t0, t1 };
  }, [a.candles, a.fib]);

  const biasColor = a.bias === "bull" ? "text-emerald-400" : a.bias === "bear" ? "text-rose-400" : "text-muted-foreground";
  const biasBg = a.bias === "bull" ? "border-emerald-500/40 bg-emerald-500/10" : a.bias === "bear" ? "border-rose-500/40 bg-rose-500/10" : "border-border bg-card";
  const BiasIcon = a.bias === "bull" ? TrendingUp : a.bias === "bear" ? TrendingDown : Minus;

  return (
    <div className="max-w-[1300px] mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/crypto" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Back to crypto</Link>
          <h1 className="text-xl font-bold">BTC — trendlines & fib</h1>
          <span className={`text-[10px] px-2 py-0.5 rounded border ${connected ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}`}>
            {connected ? "LIVE" : "OFFLINE"} · {ticks.length} ticks
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            onClick={() => setShowLines(v => !v)}
            className={`px-2 py-1 rounded border ${showLines ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-border text-muted-foreground"}`}
          >Trendlines</button>
          <button
            onClick={() => setShowFib(v => !v)}
            className={`px-2 py-1 rounded border ${showFib ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-border text-muted-foreground"}`}
          >Fibonacci</button>
        </div>
      </div>

      {/* Bias readout */}
      <div className={`border rounded-lg p-4 flex flex-wrap items-center gap-6 ${biasBg}`}>
        <div className="flex items-center gap-3">
          <BiasIcon className={`h-8 w-8 ${biasColor}`} />
          <div>
            <div className={`text-lg font-bold uppercase tracking-wider ${biasColor}`}>{a.bias}</div>
            <div className="text-[11px] text-muted-foreground">{a.reason}</div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div><div className="text-[10px] text-muted-foreground">Confidence</div><div className="font-mono">{a.confidence}%</div></div>
          <div><div className="text-[10px] text-muted-foreground">Price</div><div className="font-mono">{a.price ? "$" + a.price.toFixed(0) : "—"}</div></div>
          <div><div className="text-[10px] text-muted-foreground">Target ↑</div><div className="font-mono text-emerald-300">{a.targetUp ? "$" + a.targetUp.toFixed(0) : "—"}</div></div>
          <div><div className="text-[10px] text-muted-foreground">Target ↓</div><div className="font-mono text-rose-300">{a.targetDown ? "$" + a.targetDown.toFixed(0) : "—"}</div></div>
          {a.supportLine && (
            <div><div className="text-[10px] text-muted-foreground">Support slope</div><div className={`font-mono ${a.supportLine.slopePerMin > 0 ? "text-emerald-300" : "text-rose-300"}`}>{a.supportLine.slopePerMin >= 0 ? "+" : ""}${a.supportLine.slopePerMin.toFixed(1)}/m</div></div>
          )}
          {a.resistanceLine && (
            <div><div className="text-[10px] text-muted-foreground">Resistance slope</div><div className={`font-mono ${a.resistanceLine.slopePerMin > 0 ? "text-emerald-300" : "text-rose-300"}`}>{a.resistanceLine.slopePerMin >= 0 ? "+" : ""}${a.resistanceLine.slopePerMin.toFixed(1)}/m</div></div>
          )}
        </div>
      </div>

      {/* Candle Momentum */}
      <div className={`border rounded-lg p-3 ${cm.forecast === "big_red" ? "border-rose-500/50 bg-rose-500/10" : cm.forecast === "big_green" ? "border-emerald-500/50 bg-emerald-500/10" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Candle momentum · forming 1m</div>
            <div className={`text-lg font-bold uppercase tracking-wider ${cm.forecast === "big_red" ? "text-rose-400" : cm.forecast === "big_green" ? "text-emerald-400" : cm.forecast.endsWith("green") ? "text-emerald-300" : cm.forecast.endsWith("red") ? "text-rose-300" : "text-muted-foreground"}`}>
              {cm.ready ? cm.forecast.replace("_", " ") : "warming up"}
              {cm.ready && cm.guidance !== "neutral" && (
                <span className={`ml-2 text-[11px] px-2 py-0.5 rounded border ${cm.guidance === "sell" ? "border-rose-500/50 bg-rose-500/15 text-rose-300" : "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"}`}>
                  {cm.guidance === "sell" ? "SIGNAL: SELL" : "SIGNAL: HOLD"}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">{cm.forecastReason}</div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div><div className="text-[10px] text-muted-foreground">Confidence</div><div className="font-mono">{cm.forecastConfidence}%</div></div>
            <div><div className="text-[10px] text-muted-foreground">Proj. body</div><div className={`font-mono ${cm.forecastBody >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{cm.forecastBody >= 0 ? "+" : ""}${cm.forecastBody.toFixed(0)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">2σ threshold</div><div className="font-mono">${cm.bigThreshold.toFixed(0)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">σ body</div><div className="font-mono">${cm.sigmaBody.toFixed(0)}</div></div>
          </div>
        </div>
        {cm.recentBig.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Recent big candles (5m)</div>
            <div className="flex flex-wrap gap-1.5">
              {cm.recentBig.slice().reverse().map(e => (
                <span key={e.t} className={`text-[10px] font-mono px-2 py-0.5 rounded border ${e.side === "green" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
                  {new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {e.side === "green" ? "+" : "-"}${Math.abs(e.body).toFixed(0)} · {e.sigmaMult.toFixed(1)}σ
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="border border-border rounded-lg bg-[#0a0f16] overflow-hidden">
        {!a.ready || !scale ? (
          <div className="h-[620px] flex items-center justify-center text-muted-foreground text-sm">
            Collecting ticks — need ~8 minutes of history to draw structure…
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ background: "#0a0f16" }}>
            {/* Grid */}
            {[0.2, 0.4, 0.6, 0.8].map(f => (
              <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * PLOT_H} y2={PAD.top + f * PLOT_H} stroke="#1a2332" strokeWidth={0.5} />
            ))}

            {/* Fibonacci bands */}
            {showFib && a.fib && a.fib.levels.map((l, i) => {
              const y = scale.y(l.price);
              const alpha = l.ratio === 0.5 ? 0.6 : l.ratio === 0.618 || l.ratio === 0.382 ? 0.4 : 0.2;
              return (
                <g key={l.label}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={`rgba(251, 191, 36, ${alpha})`} strokeWidth={l.ratio === 0.5 ? 1.2 : 0.7} strokeDasharray={l.ratio === 0 || l.ratio === 1 ? "" : "4 3"} />
                  <text x={W - PAD.right + 4} y={y + 3} fontSize={10} fill="#fbbf24" opacity={0.8}>{l.label} · ${l.price.toFixed(0)}</text>
                </g>
              );
            })}

            {/* Candles */}
            {a.candles.map((c, i) => {
              const x = scale.x(c.t);
              const nextT = a.candles[i + 1]?.t ?? c.t + 60_000;
              const width = Math.max(2, (scale.x(nextT) - x) * 0.7);
              const yH = scale.y(c.h);
              const yL = scale.y(c.l);
              const yO = scale.y(c.o);
              const yC = scale.y(c.c);
              const bull = c.c >= c.o;
              const color = bull ? "#10b981" : "#ef4444";
              return (
                <g key={c.t}>
                  <line x1={x + width / 2} x2={x + width / 2} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
                  <rect x={x + (width * 0.15)} y={Math.min(yO, yC)} width={width * 0.7} height={Math.max(1, Math.abs(yC - yO))} fill={color} />
                </g>
              );
            })}

            {/* Trendlines — extended across the visible range */}
            {showLines && a.resistanceLine && (() => {
              const line = a.resistanceLine;
              const t0 = scale.t0, t1 = scale.t1;
              const dt = line.p1.t - line.p0.t;
              const yAt = (t: number) => dt === 0 ? line.p0.y : line.p0.y + ((t - line.p0.t) / dt) * (line.p1.y - line.p0.y);
              return (
                <line x1={scale.x(t0)} x2={scale.x(t1)} y1={scale.y(yAt(t0))} y2={scale.y(yAt(t1))} stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.9} />
              );
            })()}
            {showLines && a.supportLine && (() => {
              const line = a.supportLine;
              const t0 = scale.t0, t1 = scale.t1;
              const dt = line.p1.t - line.p0.t;
              const yAt = (t: number) => dt === 0 ? line.p0.y : line.p0.y + ((t - line.p0.t) / dt) * (line.p1.y - line.p0.y);
              return (
                <line x1={scale.x(t0)} x2={scale.x(t1)} y1={scale.y(yAt(t0))} y2={scale.y(yAt(t1))} stroke="#22d3ee" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.9} />
              );
            })()}

            {/* Current price marker */}
            {a.price != null && (
              <g>
                <line x1={PAD.left} x2={W - PAD.right} y1={scale.y(a.price)} y2={scale.y(a.price)} stroke="#e2e8f0" strokeWidth={0.7} strokeDasharray="2 2" opacity={0.5} />
                <rect x={W - PAD.right + 2} y={scale.y(a.price) - 9} width={PAD.right - 6} height={18} fill="#e2e8f0" rx={2} />
                <text x={W - PAD.right + 6} y={scale.y(a.price) + 4} fontSize={11} fontWeight={700} fill="#0a0f16">${a.price.toFixed(1)}</text>
              </g>
            )}

            {/* Swing anchor dots */}
            {a.fib && (
              <>
                <circle cx={scale.x(a.fib.swingHighT)} cy={scale.y(a.fib.swingHigh)} r={4} fill="#f97316" />
                <circle cx={scale.x(a.fib.swingLowT)} cy={scale.y(a.fib.swingLow)} r={4} fill="#22d3ee" />
              </>
            )}
          </svg>
        )}
      </div>


      {/* Auto-backtest: wrong predictions */}
      <div className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto-backtest</div>
            <div className="text-sm font-bold">Wrong predictions & diagnosed reasons</div>
          </div>
          <button
            onClick={() => diag.mutate()}
            disabled={diag.isPending}
            className="text-[11px] px-2 py-1 rounded border border-border hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
          >
            {diag.isPending ? "Diagnosing…" : "Diagnose new misses"}
          </button>
        </div>
        {missesQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : !missesQ.data?.misses.length ? (
          <div className="text-xs text-muted-foreground">No wrong predictions logged yet. Click "Diagnose new misses" after some settled losses to backtest them.</div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {missesQ.data.misses.map(m => (
              <div key={m.id} className="border border-border/60 rounded p-2.5 bg-background/40 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-muted-foreground">{new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="text-foreground">{m.ticker}</span>
                    <span className={`px-1.5 py-0.5 rounded border ${m.predicted_dir === "UP" ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}`}>pred {m.predicted_dir}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className={`px-1.5 py-0.5 rounded border ${m.actual_dir === "UP" ? "border-emerald-500/40 text-emerald-300" : m.actual_dir === "DOWN" ? "border-rose-500/40 text-rose-300" : "border-border text-muted-foreground"}`}>actual {m.actual_dir}</span>
                  </div>
                  {m.pnl_usd != null && (
                    <span className="font-mono text-rose-300">${Number(m.pnl_usd).toFixed(2)}</span>
                  )}
                </div>
                <div className="text-muted-foreground leading-snug">{m.diagnosed_reason}</div>
                {m.reason_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {m.reason_tags.map(t => (
                      <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Study of misses */}
      <div className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">AI model study</div>
            <div className="text-sm font-bold">
              What the model is getting wrong — proposed fixes
              {studyQ.data?.newMissesSinceStudy != null && studyQ.data.newMissesSinceStudy > 0 && (
                <span className="ml-2 text-[10px] text-amber-300 font-mono">+{studyQ.data.newMissesSinceStudy} new misses</span>
              )}
            </div>
          </div>
          <button
            onClick={() => runStudy.mutate()}
            disabled={runStudy.isPending}
            className="text-[11px] px-2 py-1 rounded border border-border hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
          >
            {runStudy.isPending ? "Studying…" : "Study with AI"}
          </button>
        </div>
        {runStudy.isError && (
          <div className="text-xs text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded p-2 mb-2">
            {(runStudy.error as Error)?.message ?? "Study failed"}
          </div>
        )}
        {!studyQ.data?.study ? (
          <div className="text-xs text-muted-foreground">
            {runStudy.isPending
              ? "AI analyzing recent misses…"
              : "No study yet. Runs automatically after 5 new wrong predictions, or click 'Study with AI'."}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground font-mono">
              Analyzed {studyQ.data.study.misses_analyzed} misses vs {studyQ.data.study.wins_analyzed} wins ·
              {" "}{new Date(studyQ.data.study.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" "}· {studyQ.data.study.model}
            </div>
            <div className="text-sm leading-relaxed">{studyQ.data.study.summary}</div>
            {studyQ.data.study.dominant_failures.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Dominant failure modes</div>
                <div className="flex flex-wrap gap-1.5">
                  {studyQ.data.study.dominant_failures.map((f, i) => (
                    <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300">{f}</span>
                  ))}
                </div>
              </div>
            )}
            {studyQ.data.study.recommendations.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Recommendations</div>
                <div className="space-y-2">
                  {studyQ.data.study.recommendations.map((r, i) => (
                    <div key={i} className={`border rounded p-2.5 text-xs ${r.priority === "high" ? "border-rose-500/40 bg-rose-500/5" : r.priority === "medium" ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background/40"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${r.priority === "high" ? "bg-rose-500/20 text-rose-300" : r.priority === "medium" ? "bg-amber-500/20 text-amber-300" : "bg-muted text-muted-foreground"}`}>{r.priority}</span>
                        <span className="font-mono text-foreground">{r.gate}</span>
                      </div>
                      <div className="text-muted-foreground mb-1">
                        <span className="text-muted-foreground">now: </span><span className="font-mono text-foreground">{r.currentSetting}</span>
                        <span className="mx-1.5">→</span>
                        <span className="text-muted-foreground">try: </span><span className="font-mono text-emerald-300">{r.suggested}</span>
                      </div>
                      <div className="leading-snug">{r.rationale}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground italic">
              These are suggestions for you to review — nothing is auto-applied to gates or thresholds.
            </div>
          </div>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground border border-border rounded-lg p-3 leading-relaxed">


        <strong className="text-foreground">How it works:</strong> Trendlines fit a least-squares line through the last 2–3 swing highs
        (<span className="text-orange-400">resistance</span>) and swing lows (<span className="text-cyan-400">support</span>) over the last 30 min.
        Fibonacci retracement is drawn between the most recent dominant swing high and low. Bias fires <span className="text-emerald-400">bull</span>
        when price breaks resistance or bounces off ascending support above the 0.5 fib, <span className="text-rose-400">bear</span> on the mirror,
        and stays neutral inside a wedge until a clean break. Feed the analysis into auto-mart with the <em>Trendline gate</em> toggle on <code>/crypto</code>.
      </div>
    </div>
  );
}
