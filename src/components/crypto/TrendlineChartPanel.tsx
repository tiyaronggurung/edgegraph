import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { evalTrendlineShadow, type TrendlineSnapshot } from "@/lib/trendlineShadow.functions";
import { detectSpike, detectTrendlines, type TCandle } from "@/lib/ta/trendlines";

// Read-only mini chart: last ~90m of 1m candles with auto-drawn trendlines
// and red dots on any candle flagged by rule (c). Fully shadow — this panel
// only visualizes what the shadow logger recorded.

export function TrendlineChartPanel() {
  const [open, setOpen] = useState(true);
  const evalFn = useServerFn(evalTrendlineShadow);
  const { data, isFetching, refetch } = useQuery<TrendlineSnapshot>({
    queryKey: ["trendline-shadow"],
    queryFn: () => evalFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="border border-white/10 rounded-lg bg-black/40 p-3">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-white/60">Trendline + Spike (shadow)</span>
          {data?.isWedge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
              WEDGE · {data.wedgeBias?.toUpperCase()}
            </span>
          )}
          {data?.spikeDetected && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
              data.spikeDirection === "up"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "bg-rose-500/20 text-rose-300 border-rose-500/40"
            }`}>
              <Zap className="h-3 w-3" /> SPIKE {data.spikeDirection?.toUpperCase()} · {data.spikeBreakPct.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); refetch(); }}
            className="text-[10px] text-white/50 hover:text-white/80"
          >
            {isFetching ? "…" : "refresh"}
          </button>
          {open ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
        </div>
      </div>

      {open && (
        <>
          <TrendlineChart data={data} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[10px]">
            <Stat label="Spot" value={data?.spot != null ? `$${data.spot.toFixed(0)}` : "—"} />
            <Stat label="Upper line" value={data?.upperAtNow != null ? `$${data.upperAtNow.toFixed(0)}` : "—"} />
            <Stat label="Lower line" value={data?.lowerAtNow != null ? `$${data.lowerAtNow.toFixed(0)}` : "—"} />
            <Stat label="Channel width" value={data?.channelWidthPct != null ? `${data.channelWidthPct.toFixed(2)}%` : "—"} />
            <Stat label="→ Upper" value={data?.distToUpperPct != null ? `${data.distToUpperPct.toFixed(3)}%` : "—"}
              icon={<TrendingUp className="h-3 w-3 text-emerald-400" />} />
            <Stat label="→ Lower" value={data?.distToLowerPct != null ? `${data.distToLowerPct.toFixed(3)}%` : "—"}
              icon={<TrendingDown className="h-3 w-3 text-rose-400" />} />
            <Stat label="Swings" value={data ? String(data.swingsUsed) : "—"} />
            <Stat label="Body ratio" value={data ? `${data.spikeBodyRatio.toFixed(2)}×` : "—"} />
          </div>
          <p className="text-[10px] text-white/40 mt-2">
            Shadow mode — logs every minute to <code>btc_trendline_shadow</code>. No trading impact until WR ≥65% over 3–5 days.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-white/5 rounded px-2 py-1 border border-white/5">
      <div className="text-white/50 flex items-center gap-1">{icon}{label}</div>
      <div className="text-white font-mono">{value}</div>
    </div>
  );
}

function TrendlineChart({ data }: { data: TrendlineSnapshot | undefined }) {
  const chart = useMemo(() => {
    if (!data || data.candles.length === 0) return null;
    const W = 600, H = 220, PAD_L = 44, PAD_R = 8, PAD_T = 8, PAD_B = 18;
    const candles = data.candles;
    // Per-candle spike flag: recompute on client using same rule for viz only.
    const trend = detectTrendlines(candles);
    const spikeFlags: boolean[] = candles.map((_, i) => {
      if (i < 21) return false;
      const slice = candles.slice(0, i + 1);
      const t2 = detectTrendlines(slice);
      const s = detectSpike(slice, t2);
      return s.detected;
    });

    const highs = candles.map(c => c.h);
    const lows = candles.map(c => c.l);
    let pMin = Math.min(...lows, data.lowerAtNow ?? Infinity);
    let pMax = Math.max(...highs, data.upperAtNow ?? -Infinity);
    const pad = (pMax - pMin) * 0.05;
    pMin -= pad; pMax += pad;
    const tMin = candles[0].t;
    const tMax = candles[candles.length - 1].t;

    const x = (t: number) => PAD_L + ((t - tMin) / (tMax - tMin || 1)) * (W - PAD_L - PAD_R);
    const y = (p: number) => PAD_T + (1 - (p - pMin) / (pMax - pMin || 1)) * (H - PAD_T - PAD_B);

    const bodyW = Math.max(1, ((W - PAD_L - PAD_R) / candles.length) * 0.7);

    return { W, H, PAD_L, PAD_R, PAD_T, PAD_B, candles, trend, spikeFlags, pMin, pMax, tMin, tMax, x, y, bodyW };
  }, [data]);

  if (!chart) {
    return <div className="h-[220px] flex items-center justify-center text-xs text-white/40">Loading chart…</div>;
  }

  const { W, H, PAD_L, PAD_B, candles, spikeFlags, x, y, bodyW, pMin, pMax, trend } = chart;

  // Trendlines: draw from first candle t to last candle t.
  const upperLine = trend.upper ? {
    x1: x(candles[0].t), y1: y(trend.upper.slope * candles[0].t + trend.upper.intercept),
    x2: x(candles[candles.length - 1].t), y2: y(trend.upper.slope * candles[candles.length - 1].t + trend.upper.intercept),
  } : null;
  const lowerLine = trend.lower ? {
    x1: x(candles[0].t), y1: y(trend.lower.slope * candles[0].t + trend.lower.intercept),
    x2: x(candles[candles.length - 1].t), y2: y(trend.lower.slope * candles[candles.length - 1].t + trend.lower.intercept),
  } : null;

  // Y-axis ticks: 4 evenly spaced price labels.
  const ticks = [0, 0.33, 0.66, 1].map(f => {
    const p = pMin + (pMax - pMin) * (1 - f);
    return { p, y: y(p) };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px] mt-2" preserveAspectRatio="none">
      {/* grid + y-axis labels */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={t.y} x2={W - 4} y2={t.y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <text x={4} y={t.y + 3} fill="rgba(255,255,255,0.4)" fontSize={9} fontFamily="monospace">
            ${t.p.toFixed(0)}
          </text>
        </g>
      ))}

      {/* candles */}
      {candles.map((c, i) => {
        const cx = x(c.t);
        const green = c.c >= c.o;
        const wickTop = y(c.h);
        const wickBot = y(c.l);
        const bodyTop = y(Math.max(c.o, c.c));
        const bodyBot = y(Math.min(c.o, c.c));
        const color = green ? "rgb(74, 222, 128)" : "rgb(248, 113, 113)";
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={i}>
            <line x1={cx} y1={wickTop} x2={cx} y2={wickBot} stroke={color} strokeWidth={1} opacity={0.7} />
            <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} opacity={0.85} />
            {spikeFlags[i] && (
              <circle cx={cx} cy={y(c.c)} r={3.5} fill="rgb(250, 204, 21)" stroke="rgb(0,0,0)" strokeWidth={0.5} />
            )}
          </g>
        );
      })}

      {/* trendlines */}
      {upperLine && (
        <line x1={upperLine.x1} y1={upperLine.y1} x2={upperLine.x2} y2={upperLine.y2}
          stroke="rgb(251, 191, 36)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.9} />
      )}
      {lowerLine && (
        <line x1={lowerLine.x1} y1={lowerLine.y1} x2={lowerLine.x2} y2={lowerLine.y2}
          stroke="rgb(251, 191, 36)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.9} />
      )}

      {/* strike line if in view */}
      {data?.strike != null && data.strike >= pMin && data.strike <= pMax && (
        <>
          <line x1={PAD_L} y1={y(data.strike)} x2={W - 4} y2={y(data.strike)}
            stroke="rgb(96, 165, 250)" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
          <text x={W - 4} y={y(data.strike) - 2} textAnchor="end" fill="rgb(96, 165, 250)" fontSize={9} fontFamily="monospace">
            strike ${data.strike.toFixed(0)}
          </text>
        </>
      )}

      {/* x-axis baseline */}
      <line x1={PAD_L} y1={H - PAD_B} x2={W - 4} y2={H - PAD_B} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
    </svg>
  );
}
