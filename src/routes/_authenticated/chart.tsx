import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useBinanceBtcTicks } from "@/hooks/useBinanceBtcTicks";
import { useTrendlineAnalysis } from "@/hooks/useTrendlineAnalysis";
import { useCandleMomentum } from "@/hooks/useCandleMomentum";

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
