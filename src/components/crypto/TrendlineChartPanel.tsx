import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { evalTrendlineShadow, type TrendlineSnapshot } from "@/lib/trendlineShadow.functions";
import { detectSpike, detectTrendlines, type TCandle } from "@/lib/ta/trendlines";
import { emaSeries, rsi, macd, bollinger, sessionVwap } from "@/lib/ta/taEngine";
import type { Candle } from "@/lib/ta/chartSignals";

// Full-fidelity TA chart: 300× 1m candles (~5 hrs), horizontally scrollable,
// with the same indicator stack our TA v2 engine actually consumes:
//   EMA 9 / 21 / 55 / 145 / 169, session VWAP, Bollinger bands (20,2),
//   plus RSI(14) and MACD(12/26/9) as sub-panels below price.
// Strike line + trendlines + spike dots kept from the shadow layer.

const SERIES: Array<{
  key: "ema9" | "ema21" | "ema55" | "ema145" | "ema169" | "vwap" | "bbUpper" | "bbLower";
  label: string;
  color: string;
  dash?: string;
  defaultOn: boolean;
}> = [
  { key: "ema9",     label: "EMA 9",   color: "rgb(250, 204, 21)",  defaultOn: true  },
  { key: "ema21",    label: "EMA 21",  color: "rgb(96, 165, 250)",  defaultOn: true  },
  { key: "ema55",    label: "EMA 55",  color: "rgb(251, 146, 60)",  defaultOn: true  },
  { key: "ema145",   label: "EMA 145", color: "rgb(232, 121, 249)", defaultOn: true  },
  { key: "ema169",   label: "EMA 169", color: "rgb(244, 63, 94)",   defaultOn: true  },
  { key: "vwap",     label: "VWAP",    color: "rgb(52, 211, 153)",  dash: "5 3", defaultOn: true  },
  { key: "bbUpper",  label: "BB Upper",color: "rgba(148, 163, 184, 0.85)", dash: "3 3", defaultOn: false },
  { key: "bbLower",  label: "BB Lower",color: "rgba(148, 163, 184, 0.85)", dash: "3 3", defaultOn: false },
];

export function TrendlineChartPanel() {
  const [open, setOpen] = useState(true);
  const evalFn = useServerFn(evalTrendlineShadow);
  const { data, isFetching, refetch } = useQuery<TrendlineSnapshot>({
    queryKey: ["trendline-shadow"],
    queryFn: () => evalFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SERIES.map(s => [s.key, s.defaultOn]))
  );

  return (
    <div className="border border-white/10 rounded-lg bg-black/40 p-3">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-white/60">
            BTC 1m · TA v2 · Trendlines
          </span>
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
          <Legend visible={visible} setVisible={setVisible} strike={data?.strike ?? null} />
          <TaChart data={data} visible={visible} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[10px]">
            <Stat label="Spot"          value={data?.spot != null ? `$${data.spot.toFixed(0)}` : "—"} />
            <Stat label="Strike"        value={data?.strike != null ? `$${data.strike.toFixed(0)}` : "—"} />
            <Stat label="Upper line"    value={data?.upperAtNow != null ? `$${data.upperAtNow.toFixed(0)}` : "—"} />
            <Stat label="Lower line"    value={data?.lowerAtNow != null ? `$${data.lowerAtNow.toFixed(0)}` : "—"} />
            <Stat label="→ Upper"       value={data?.distToUpperPct != null ? `${data.distToUpperPct.toFixed(3)}%` : "—"}
                  icon={<TrendingUp className="h-3 w-3 text-emerald-400" />} />
            <Stat label="→ Lower"       value={data?.distToLowerPct != null ? `${data.distToLowerPct.toFixed(3)}%` : "—"}
                  icon={<TrendingDown className="h-3 w-3 text-rose-400" />} />
            <Stat label="Channel width" value={data?.channelWidthPct != null ? `${data.channelWidthPct.toFixed(2)}%` : "—"} />
            <Stat label="Swings used"   value={data ? String(data.swingsUsed) : "—"} />
          </div>

          <p className="text-[10px] text-white/40 mt-2">
            Scroll horizontally to see the full 300-minute window · toggle series in the legend · sub-panels show RSI(14) and MACD(12/26/9). Shadow mode — no trading impact until WR ≥65% over 3–5 days.
          </p>
        </>
      )}
    </div>
  );
}

function Legend({
  visible, setVisible, strike,
}: {
  visible: Record<string, boolean>;
  setVisible: (v: Record<string, boolean>) => void;
  strike: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {SERIES.map(s => {
        const on = visible[s.key];
        return (
          <button
            key={s.key}
            onClick={() => setVisible({ ...visible, [s.key]: !on })}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition ${
              on ? "border-white/20 bg-white/5 text-white" : "border-white/10 bg-transparent text-white/40"
            }`}
          >
            <span className="inline-block w-3 h-[2px]" style={{ background: s.color }} />
            {s.label}
          </button>
        );
      })}
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-sky-400/40 bg-sky-500/10 text-[10px] font-mono text-sky-300">
        <span className="inline-block w-3 h-[2px] border-t-2 border-dashed border-sky-400" />
        Strike {strike != null ? `$${strike.toFixed(0)}` : "—"}
      </span>
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-mono text-amber-300">
        <span className="inline-block w-3 h-[2px] border-t-2 border-dashed border-amber-400" />
        Trendlines
      </span>
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-yellow-400/40 bg-yellow-400/10 text-[10px] font-mono text-yellow-300">
        <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
        Spike
      </span>
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

// ── The chart ─────────────────────────────────────────────────────────────
function TaChart({
  data, visible,
}: {
  data: TrendlineSnapshot | undefined;
  visible: Record<string, boolean>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const priceH = 300;
  const rsiH = 70;
  const macdH = 70;
  const PAD_L = 52, PAD_R = 72, PAD_T = 10, PAD_B = 6;
  const CANDLE_W = 6; // px per candle in the scrollable area

  const computed = useMemo(() => {
    if (!data || data.candles.length === 0) return null;
    const candles = data.candles;
    const closes = candles.map(c => c.c);
    const cAsCandle: Candle[] = candles.map(c => ({
      t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 1,
    }));

    // Indicators — same math the server engine uses.
    const e9   = emaSeries(closes, 9);
    const e21  = emaSeries(closes, 21);
    const e55  = closes.length >= 60  ? emaSeries(closes, 55)  : null;
    const e145 = closes.length >= 150 ? emaSeries(closes, 145) : null;
    const e169 = closes.length >= 170 ? emaSeries(closes, 169) : null;

    // Rolling session VWAP series (recompute at each i using taEngine.sessionVwap).
    const vwapSeries: (number | null)[] = candles.map((_, i) =>
      i < 1 ? null : sessionVwap(cAsCandle.slice(0, i + 1))
    );

    // Rolling Bollinger series (upper/lower) — 20-period on closes.
    const bbUpper: (number | null)[] = [];
    const bbLower: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < 19) { bbUpper.push(null); bbLower.push(null); continue; }
      const bb = bollinger(closes.slice(0, i + 1), 20, 2);
      bbUpper.push(bb ? bb.upper : null);
      bbLower.push(bb ? bb.lower : null);
    }

    // Trendlines and per-candle spike flags (visual only).
    const trend = detectTrendlines(candles);
    const spikeFlags: boolean[] = candles.map((_, i) => {
      if (i < 21) return false;
      const slice = candles.slice(0, i + 1);
      const t2 = detectTrendlines(slice);
      const s = detectSpike(slice, t2);
      return s.detected;
    });

    // RSI + MACD series for sub-panels.
    const rsiSeries: (number | null)[] = closes.map((_, i) =>
      i < 14 ? null : rsi(closes.slice(0, i + 1), 14)
    );

    // MACD histogram (need >=35 closes to start).
    const macdHist: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < 35) { macdHist.push(null); continue; }
      const m = macd(closes.slice(0, i + 1));
      macdHist.push(m ? m.hist : null);
    }

    // Price axis: include EMAs, VWAP, BB and strike so nothing clips.
    const highs = candles.map(c => c.h);
    const lows  = candles.map(c => c.l);
    const extras: number[] = [];
    for (const arr of [e9, e21, e55 ?? [], e145 ?? [], e169 ?? []]) extras.push(...arr);
    for (const v of vwapSeries) if (v != null) extras.push(v);
    for (const v of bbUpper) if (v != null) extras.push(v);
    for (const v of bbLower) if (v != null) extras.push(v);
    if (data.strike != null) extras.push(data.strike);
    if (data.upperAtNow != null) extras.push(data.upperAtNow);
    if (data.lowerAtNow != null) extras.push(data.lowerAtNow);
    let pMin = Math.min(...lows, ...extras);
    let pMax = Math.max(...highs, ...extras);
    const pad = (pMax - pMin) * 0.04;
    pMin -= pad; pMax += pad;

    return {
      candles, e9, e21, e55, e145, e169, vwapSeries, bbUpper, bbLower,
      rsiSeries, macdHist, trend, spikeFlags, pMin, pMax,
    };
  }, [data]);

  // On first load / refresh, snap the scroll container to the right.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [computed]);

  if (!computed) {
    return <div className="h-[320px] mt-2 flex items-center justify-center text-xs text-white/40">Loading chart…</div>;
  }

  const c = computed;
  const nCandles = c.candles.length;
  const innerW = PAD_L + PAD_R + nCandles * CANDLE_W;

  // Scales
  const xFor = (i: number) => PAD_L + i * CANDLE_W + CANDLE_W / 2;
  const yPrice = (p: number) =>
    PAD_T + (1 - (p - c.pMin) / (c.pMax - c.pMin || 1)) * (priceH - PAD_T - PAD_B);
  const yRsi = (v: number) => PAD_T + (1 - v / 100) * (rsiH - PAD_T - PAD_B);
  const macdMax = Math.max(0.001, ...c.macdHist.map(v => (v == null ? 0 : Math.abs(v))));
  const yMacd = (v: number) =>
    PAD_T + (1 - (v + macdMax) / (2 * macdMax || 1)) * (macdH - PAD_T - PAD_B);
  const bodyW = Math.max(1.5, CANDLE_W * 0.65);

  // Build indicator polylines.
  const line = (series: readonly (number | null)[], stroke: string, dash?: string, opacity = 1) => {
    const pts: string[] = [];
    let started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v == null || !Number.isFinite(v)) { started = false; continue; }
      pts.push(`${started ? "L" : "M"}${xFor(i).toFixed(1)} ${yPrice(v).toFixed(1)}`);
      started = true;
    }
    if (pts.length === 0) return null;
    return <path d={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={1.4} strokeDasharray={dash} opacity={opacity} />;
  };

  // Price-axis ticks + strike label.
  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const p = c.pMin + (c.pMax - c.pMin) * (1 - f);
    return { p, y: yPrice(p) };
  });

  // Trendlines rendered across full width.
  const t0 = c.candles[0].t;
  const tN = c.candles[nCandles - 1].t;
  const iAtT = (t: number) => (nCandles - 1) * ((t - t0) / (tN - t0 || 1));
  const upper = c.trend.upper;
  const lower = c.trend.lower;

  return (
    <div ref={scrollRef} className="mt-2 overflow-x-auto overflow-y-hidden border border-white/5 rounded bg-black/30">
      <svg
        width={innerW}
        height={priceH + rsiH + macdH + 24}
        className="block"
      >
        {/* ── Price panel ── */}
        <g>
          {/* horizontal grid */}
          {priceTicks.map((t, i) => (
            <line key={i} x1={PAD_L} y1={t.y} x2={innerW - PAD_R} y2={t.y}
              stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          ))}
          {/* y-axis labels — right side (primary, like TradingView) + faint left mirror */}
          {priceTicks.map((t, i) => (
            <g key={`l${i}`}>
              <text x={4} y={t.y + 3} fill="rgba(255,255,255,0.25)"
                fontSize={10} fontFamily="monospace">
                ${t.p.toFixed(0)}
              </text>
              <text x={innerW - PAD_R + 6} y={t.y + 3} fill="rgba(255,255,255,0.6)"
                fontSize={10} fontFamily="monospace">
                ${t.p.toFixed(2)}
              </text>
            </g>
          ))}

          {/* candles */}
          {c.candles.map((cd, i) => {
            const cx = xFor(i);
            const green = cd.c >= cd.o;
            const color = green ? "rgb(74, 222, 128)" : "rgb(248, 113, 113)";
            const bodyTop = yPrice(Math.max(cd.o, cd.c));
            const bodyBot = yPrice(Math.min(cd.o, cd.c));
            return (
              <g key={i}>
                <line x1={cx} y1={yPrice(cd.h)} x2={cx} y2={yPrice(cd.l)}
                  stroke={color} strokeWidth={1} opacity={0.75} />
                <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW}
                  height={Math.max(1, bodyBot - bodyTop)} fill={color} opacity={0.9} />
                {c.spikeFlags[i] && (
                  <circle cx={cx} cy={yPrice(cd.c)} r={3.5}
                    fill="rgb(250, 204, 21)" stroke="rgb(0,0,0)" strokeWidth={0.5} />
                )}
              </g>
            );
          })}

          {/* indicator overlays (toggled) */}
          {visible.ema9   && line(c.e9,   "rgb(250, 204, 21)")}
          {visible.ema21  && line(c.e21,  "rgb(96, 165, 250)")}
          {visible.ema55  && c.e55  && line(c.e55,  "rgb(251, 146, 60)")}
          {visible.ema145 && c.e145 && line(c.e145, "rgb(232, 121, 249)")}
          {visible.ema169 && c.e169 && line(c.e169, "rgb(244, 63, 94)")}
          {visible.vwap    && line(c.vwapSeries, "rgb(52, 211, 153)", "5 3")}
          {visible.bbUpper && line(c.bbUpper, "rgba(148, 163, 184, 0.85)", "3 3", 0.9)}
          {visible.bbLower && line(c.bbLower, "rgba(148, 163, 184, 0.85)", "3 3", 0.9)}

          {/* trendlines */}
          {upper && (
            <line
              x1={xFor(0)} y1={yPrice(upper.slope * t0 + upper.intercept)}
              x2={xFor(nCandles - 1)} y2={yPrice(upper.slope * tN + upper.intercept)}
              stroke="rgb(251, 191, 36)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85}
            />
          )}
          {lower && (
            <line
              x1={xFor(0)} y1={yPrice(lower.slope * t0 + lower.intercept)}
              x2={xFor(nCandles - 1)} y2={yPrice(lower.slope * tN + lower.intercept)}
              stroke="rgb(251, 191, 36)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85}
            />
          )}

          {/* strike line — bold, labeled at both ends */}
          {data?.strike != null && data.strike >= c.pMin && data.strike <= c.pMax && (
            <>
              <line
                x1={PAD_L} y1={yPrice(data.strike)}
                x2={innerW - PAD_R} y2={yPrice(data.strike)}
                stroke="rgb(56, 189, 248)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.9}
              />
              <rect
                x={PAD_L + 4} y={yPrice(data.strike) - 10}
                width={92} height={16} rx={3}
                fill="rgba(2, 132, 199, 0.85)"
              />
              <text
                x={PAD_L + 10} y={yPrice(data.strike) + 2}
                fill="white" fontSize={11} fontFamily="monospace" fontWeight={600}
              >
                STRIKE ${data.strike.toFixed(0)}
              </text>
            </>
          )}

          {/* current price marker on the right edge */}
          {(() => {
            const last = c.candles[nCandles - 1];
            const yy = yPrice(last.c);
            return (
              <>
                <line
                  x1={PAD_L} y1={yy} x2={innerW - PAD_R} y2={yy}
                  stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2 3"
                />
                <rect
                  x={innerW - PAD_R - 72} y={yy - 9} width={68} height={16} rx={3}
                  fill="rgba(0,0,0,0.7)" stroke="rgba(255,255,255,0.35)"
                />
                <text
                  x={innerW - PAD_R - 6} y={yy + 3} textAnchor="end"
                  fill="white" fontSize={11} fontFamily="monospace"
                >
                  ${last.c.toFixed(0)}
                </text>
              </>
            );
          })()}
        </g>

        {/* ── RSI panel ── */}
        <g transform={`translate(0, ${priceH + 12})`}>
          <rect x={0} y={0} width={innerW} height={rsiH} fill="rgba(255,255,255,0.02)" />
          <text x={4} y={12} fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">RSI 14</text>
          {[70, 50, 30].map(v => (
            <g key={v}>
              <line x1={PAD_L} y1={yRsi(v)} x2={innerW - PAD_R} y2={yRsi(v)}
                stroke={v === 50 ? "rgba(255,255,255,0.15)" : "rgba(148, 163, 184, 0.25)"}
                strokeDasharray={v === 50 ? "2 4" : undefined} strokeWidth={1} />
              <text x={4} y={yRsi(v) + 3} fill="rgba(255,255,255,0.4)"
                fontSize={9} fontFamily="monospace">{v}</text>
            </g>
          ))}
          {(() => {
            const pts: string[] = [];
            let started = false;
            for (let i = 0; i < c.rsiSeries.length; i++) {
              const v = c.rsiSeries[i];
              if (v == null) { started = false; continue; }
              pts.push(`${started ? "L" : "M"}${xFor(i).toFixed(1)} ${yRsi(v).toFixed(1)}`);
              started = true;
            }
            return <path d={pts.join(" ")} fill="none" stroke="rgb(167, 139, 250)" strokeWidth={1.3} />;
          })()}
        </g>

        {/* ── MACD panel ── */}
        <g transform={`translate(0, ${priceH + rsiH + 20})`}>
          <rect x={0} y={0} width={innerW} height={macdH} fill="rgba(255,255,255,0.02)" />
          <text x={4} y={12} fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">MACD 12/26/9</text>
          <line x1={PAD_L} y1={yMacd(0)} x2={innerW - PAD_R} y2={yMacd(0)}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          {c.macdHist.map((v, i) => {
            if (v == null) return null;
            const y0 = yMacd(0);
            const yv = yMacd(v);
            const top = Math.min(y0, yv);
            const h = Math.max(1, Math.abs(yv - y0));
            const color = v >= 0 ? "rgb(74, 222, 128)" : "rgb(248, 113, 113)";
            return (
              <rect key={i} x={xFor(i) - bodyW / 2} y={top} width={bodyW} height={h}
                fill={color} opacity={0.85} />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
