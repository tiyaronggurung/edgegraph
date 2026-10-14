// Kalshi-style live UP vs DOWN line chart for the current 15m window.
// Presentation only: samples the odds already computed on the page into an
// in-memory buffer. Never feeds trading, model, Study or exit paths.
import { useEffect, useRef, useState } from "react";

type Pt = { t: number; up: number };
const WIN_MS = 900_000;
const SAMPLE_MS = 1_000;
const W = 900;
const H = 220;
const PAD_R = 110;
const PAD_T = 12;
const PAD_B = 24;

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");

export function LiveOddsLineChart({ upAsk, winStart }: { upAsk: number | null; winStart: number }) {
  const [pts, setPts] = useState<Pt[]>([]);
  const latest = useRef<number | null>(upAsk);
  latest.current = upAsk;
  const [hover, setHover] = useState<number | null>(null);

  // Reset on window rollover.
  useEffect(() => setPts([]), [winStart]);

  useEffect(() => {
    const id = setInterval(() => {
      const v = latest.current;
      if (v == null || !Number.isFinite(v)) return;
      const t = Date.now();
      if (t < winStart || t >= winStart + WIN_MS) return;
      setPts((p) => [...p, { t, up: v }]);
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [winStart]);

  const plotW = W - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (t: number) => ((t - winStart) / WIN_MS) * plotW;
  const y = (p: number) => PAD_T + (1 - p) * plotH;
  const path = (f: (p: Pt) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(f(p)).toFixed(1)}`).join("");

  const last = pts[pts.length - 1];
  const shown = hover != null ? pts[hover] : last;
  const upC = shown ? Math.round(shown.up * 100) : null;
  const downC = upC == null ? null : 100 - upC;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tx = winStart + (((e.clientX - r.left) / r.width) * W / plotW) * WIN_MS;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - tx) < Math.abs(pts[best].t - tx)) best = i;
    setHover(best);
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const timeTicks = [0, 5, 10, 15].map((m) => winStart + m * 60_000);
  const upLabelY = last ? y(last.up) : 0;
  const downLabelY = last ? y(1 - last.up) : 0;
  const sep = Math.abs(upLabelY - downLabelY) < 44;
  const upTop = last ? last.up >= 0.5 : true;
  const uy = sep ? (upTop ? Math.min(upLabelY, downLabelY) - 12 : Math.max(upLabelY, downLabelY) + 12) : upLabelY;
  const dy = sep ? (upTop ? Math.max(upLabelY, downLabelY) + 12 : Math.min(upLabelY, downLabelY) - 12) : downLabelY;

  return (
    <section className="border border-border rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Our odds · live UP vs DOWN</div>
        <div className="text-[11px] text-muted-foreground">
          {shown ? fmtTime(shown.t) : "waiting for odds…"} · window {fmtTime(winStart)}–{fmtTime(winStart + WIN_MS)}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((p) => (
          <g key={p}>
            <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke="var(--color-border)" strokeDasharray={p === 0.5 ? "4 4" : "1 5"} />
            <text x={W - 4} y={y(p) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted-foreground)">{p * 100}%</text>
          </g>
        ))}
        {timeTicks.map((t, i) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize="11" fill="var(--color-muted-foreground)">{fmtTime(t)}</text>
        ))}
        {pts.length > 1 && (
          <>
            <path d={path((p) => 1 - p.up)} fill="none" stroke="var(--color-destructive)" strokeWidth={2} strokeLinejoin="round" />
            <path d={path((p) => p.up)} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
        {hover != null && pts[hover] && (
          <line x1={x(pts[hover].t)} x2={x(pts[hover].t)} y1={PAD_T} y2={PAD_T + plotH} stroke="var(--color-muted-foreground)" strokeDasharray="2 3" />
        )}
        {last && (
          <>
            <circle cx={x(last.t)} cy={y(last.up)} r={4} fill="var(--color-primary)">
              <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <circle cx={x(last.t)} cy={y(1 - last.up)} r={4} fill="var(--color-destructive)">
              <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <g transform={`translate(${Math.min(x(last.t) + 10, plotW - 70)},0)`}>
              <text y={uy - 2} fontSize="12" fontWeight="600" fill="var(--color-primary)">Up</text>
              <text y={uy + 18} fontSize="20" fontWeight="700" fill="var(--color-primary)">{upC}¢</text>
              <text y={dy - 2} fontSize="12" fontWeight="600" fill="var(--color-destructive)">Down</text>
              <text y={dy + 18} fontSize="20" fontWeight="700" fill="var(--color-destructive)">{downC}¢</text>
            </g>
          </>
        )}
      </svg>
    </section>
  );
}
