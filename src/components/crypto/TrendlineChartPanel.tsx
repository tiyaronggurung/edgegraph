import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { evalTrendlineShadow, type TrendlineSnapshot } from "@/lib/trendlineShadow.functions";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { getBtcCandles, TF_LIST, type CandleTf } from "@/lib/btcCandles.functions";
import { detectSpike, detectTrendlines, type TCandle } from "@/lib/ta/trendlines";
import { emaSeries, rsi, macd, bollinger, sessionVwap } from "@/lib/ta/taEngine";
import { fibLevels, FIB_COLORS } from "@/lib/ta/fib";
import type { Candle } from "@/lib/ta/chartSignals";

// Full-fidelity TA chart with multi-timeframe support:
//   1m / 5m / 15m / 1h / 1d / 1w — sourced from public.btc_candles cache
//   (topped up live from Coinbase when the cache is stale).
// Indicators: EMA 9/21/55/145/169, session VWAP, Bollinger, plus RSI + MACD.
// Overlays: strike line, spike dots, trendlines, and Fibonacci retracements
// computed from whatever candles are currently in the viewport.

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

const TF_LABEL: Record<CandleTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "1d": "1D",
};
// Refetch cadence per tf — for 1m we poll aggressively so the forming bar
// moves; between server refetches we still splice live spot into the last
// candle every render so the chart is never visibly frozen.
const TF_REFETCH_MS: Record<CandleTf, number> = {
  "1m": 5_000, "5m": 30_000, "15m": 60_000, "1h": 5 * 60_000, "1d": 30 * 60_000,
};

export function TrendlineChartPanel() {
  const [open, setOpen] = useState(true);
  const [tf, setTf] = useState<CandleTf>("1m");
  const [fibOn, setFibOn] = useState(true);
  const evalFn = useServerFn(evalTrendlineShadow);
  const candlesFn = useServerFn(getBtcCandles);
  const kalshiFn = useServerFn(getKalshiImpliedSpot);

  const { data: kalshi } = useQuery({
    queryKey: ["kalshi-implied-spot"],
    queryFn: () => kalshiFn(),
    refetchInterval: 5_000,
    staleTime: 4_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  // Strike / wedge / spike metadata — only meaningful on 1m; keep the existing shadow query.
  const { data: shadow, isFetching: shadowFetching, refetch: refetchShadow } = useQuery<TrendlineSnapshot>({
    queryKey: ["trendline-shadow"],
    queryFn: () => evalFn(),
    refetchInterval: 30_000,
    staleTime: 25_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Candles per-tf. keepPreviousData → switching tf keeps old chart visible
  // until new candles arrive, so the chart never blanks out.
  const { data: candlesData, isFetching: candlesFetching } = useQuery({
    queryKey: ["btc-candles", tf],
    queryFn: () => candlesFn({ data: { tf, limit: tf === "1m" ? 500 : 300 } }),
    refetchInterval: TF_REFETCH_MS[tf],
    staleTime: TF_REFETCH_MS[tf] - 2_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const candles = candlesData?.candles ?? shadow?.candles ?? [];
  const isFetching = candlesFetching || shadowFetching;
  const refetch = () => { refetchShadow(); };


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
            BTC {TF_LABEL[tf]} · TA v2 · Trendlines
          </span>
          {(() => {
            const ours = shadow?.spot ?? null;
            const k = kalshi?.impliedSpot ?? null;
            const diff = ours != null && k != null ? ours - k : null;
            const diffCls =
              diff == null ? "text-white/40" :
              Math.abs(diff) < 5 ? "text-white/50" :
              diff > 0 ? "text-emerald-300" : "text-rose-300";
            return (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 font-mono flex items-center gap-1.5"
                title={
                  kalshi?.ok
                    ? `Kalshi ${kalshi.ticker} · YES mid ${((kalshi.yesMid ?? 0) * 100).toFixed(1)}¢ · strike $${kalshi.strike?.toFixed(0)} · ${kalshi.secondsToClose}s to close · implied spot inverted from YES prob via Φ⁻¹`
                    : `Kalshi implied spot unavailable${kalshi?.error ? ` — ${kalshi.error}` : ""}`
                }
              >
                <span className="text-white/50">Kalshi</span>
                <span className="tabular-nums">
                  {k != null ? `$${k.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                </span>
                <span className="text-white/40">vs ours</span>
                <span className="tabular-nums">
                  {ours != null ? `$${ours.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                </span>
                {diff != null && (
                  <span className={`tabular-nums ${diffCls}`}>
                    {diff >= 0 ? "+" : ""}${diff.toFixed(1)}
                  </span>
                )}
              </span>
            );
          })()}
          {tf === "1m" && shadow?.isWedge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
              WEDGE · {shadow.wedgeBias?.toUpperCase()}
            </span>
          )}
          {tf === "1m" && shadow?.spikeDetected && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
              shadow.spikeDirection === "up"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "bg-rose-500/20 text-rose-300 border-rose-500/40"
            }`}>
              <Zap className="h-3 w-3" /> SPIKE {shadow.spikeDirection?.toUpperCase()} · {shadow.spikeBreakPct.toFixed(2)}%
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
          <div className="flex items-center gap-1.5 mt-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] text-white/40 mr-1">TF:</span>
            {TF_LIST.map(t => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                  tf === t
                    ? "bg-white/10 border-white/40 text-white"
                    : "bg-transparent border-white/10 text-white/50 hover:text-white/80 hover:border-white/20"
                }`}
              >
                {TF_LABEL[t]}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-white/10" />
            <button
              onClick={() => setFibOn(v => !v)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                fibOn
                  ? "bg-yellow-400/10 border-yellow-400/40 text-yellow-200"
                  : "bg-transparent border-white/10 text-white/40 hover:text-white/70"
              }`}
              title="Fibonacci retracements over the visible viewport"
            >
              Fib {fibOn ? "on" : "off"}
            </button>
            {candlesData?.source && (
              <span className="ml-auto text-[9px] text-white/30 font-mono">
                src: {candlesData.source} · {candles.length}
              </span>
            )}
          </div>

          <Legend visible={visible} setVisible={setVisible} strike={shadow?.strike ?? null} />
          <TaChart candles={candles} shadow={shadow ?? null} tf={tf} visible={visible} fibOn={fibOn} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[10px]">
            <Stat label="Spot"          value={shadow?.spot != null ? `$${shadow.spot.toFixed(0)}` : "—"} />
            <Stat label="Strike"        value={shadow?.strike != null ? `$${shadow.strike.toFixed(0)}` : "—"} />
            <Stat
              label="Δ Strike"
              value={
                shadow?.spot != null && shadow?.strike != null
                  ? `${(shadow.spot - shadow.strike) >= 0 ? "+" : ""}$${(shadow.spot - shadow.strike).toFixed(2)} ${shadow.spot >= shadow.strike ? "above" : "below"}`
                  : "—"
              }
              icon={
                shadow?.spot != null && shadow?.strike != null ? (
                  shadow.spot >= shadow.strike
                    ? <TrendingUp className="h-3 w-3 text-emerald-400" />
                    : <TrendingDown className="h-3 w-3 text-rose-400" />
                ) : undefined
              }
            />
            <Stat label="Upper line"    value={shadow?.upperAtNow != null ? `$${shadow.upperAtNow.toFixed(0)}` : "—"} />
            <Stat label="Lower line"    value={shadow?.lowerAtNow != null ? `$${shadow.lowerAtNow.toFixed(0)}` : "—"} />
            <Stat label="→ Upper"       value={shadow?.distToUpperPct != null ? `${shadow.distToUpperPct.toFixed(3)}%` : "—"}
                  icon={<TrendingUp className="h-3 w-3 text-emerald-400" />} />
            <Stat label="→ Lower"       value={shadow?.distToLowerPct != null ? `${shadow.distToLowerPct.toFixed(3)}%` : "—"}
                  icon={<TrendingDown className="h-3 w-3 text-rose-400" />} />
            <Stat label="Channel width" value={shadow?.channelWidthPct != null ? `${shadow.channelWidthPct.toFixed(2)}%` : "—"} />
            <Stat label="Swings used"   value={shadow ? String(shadow.swingsUsed) : "—"} />
          </div>

          <p className="text-[10px] text-white/40 mt-2">
            Drag to pan · wheel to zoom · switch TF above · Fib is drawn from the highest high / lowest low currently visible.
            Shadow mode — no trading impact until WR ≥65% over 3–5 days.
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
const MIN_CW = 2;
const MAX_CW = 32;
const DEFAULT_CW = 6;

function TaChart({
  candles: candlesProp, shadow, tf, visible, fibOn,
}: {
  candles: TCandle[];
  shadow: TrendlineSnapshot | null;
  tf: CandleTf;
  visible: Record<string, boolean>;
  fibOn: boolean;
}) {
  // Alias so the rest of the component (which references `data.strike` etc.)
  // keeps compiling. `data` here represents the shadow-analysis snapshot only
  // (strike / wedge / spike / etc.); actual candles come from `candlesProp`.
  const data = shadow;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [candleW, setCandleW] = useState<number>(DEFAULT_CW);
  // Bumped on every scroll — triggers Fib recompute for the new viewport.
  const [viewportTick, setViewportTick] = useState(0);
  // Force scroll snap when TF changes (new dataset).
  useEffect(() => { setSelectedIdx(null); }, [tf]);
  const priceH = 300;
  const rsiH = 70;
  const macdH = 70;
  const PAD_L = 52, PAD_R = 72, PAD_T = 10, PAD_B = 6;
  const CANDLE_W = candleW;
  const FUTURE_SLOTS = 30; // empty room to the right of the last candle for upcoming candles

  const computed = useMemo(() => {
    if (candlesProp.length === 0) return null;
    const candles = candlesProp;
    const closes = candles.map(c => c.c);
    const cAsCandle: Candle[] = candles.map(c => ({
      t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 1,
    }));

    const e9   = emaSeries(closes, 9);
    const e21  = emaSeries(closes, 21);
    const e55  = closes.length >= 60  ? emaSeries(closes, 55)  : null;
    const e145 = closes.length >= 150 ? emaSeries(closes, 145) : null;
    const e169 = closes.length >= 170 ? emaSeries(closes, 169) : null;

    const vwapSeries: (number | null)[] = candles.map((_, i) =>
      i < 1 ? null : sessionVwap(cAsCandle.slice(0, i + 1))
    );

    const bbUpper: (number | null)[] = [];
    const bbLower: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < 19) { bbUpper.push(null); bbLower.push(null); continue; }
      const bb = bollinger(closes.slice(0, i + 1), 20, 2);
      bbUpper.push(bb ? bb.upper : null);
      bbLower.push(bb ? bb.lower : null);
    }

    const trend = detectTrendlines(candles);
    const spikeFlags: boolean[] = candles.map((_, i) => {
      if (i < 21) return false;
      const slice = candles.slice(0, i + 1);
      const t2 = detectTrendlines(slice);
      const s = detectSpike(slice, t2);
      return s.detected;
    });

    const rsiSeries: (number | null)[] = closes.map((_, i) =>
      i < 14 ? null : rsi(closes.slice(0, i + 1), 14)
    );

    const macdHist: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < 35) { macdHist.push(null); continue; }
      const m = macd(closes.slice(0, i + 1));
      macdHist.push(m ? m.hist : null);
    }

    const highs = candles.map(c => c.h);
    const lows  = candles.map(c => c.l);
    const extras: number[] = [];
    for (const arr of [e9, e21, e55 ?? [], e145 ?? [], e169 ?? []]) extras.push(...arr);
    for (const v of vwapSeries) if (v != null) extras.push(v);
    for (const v of bbUpper) if (v != null) extras.push(v);
    for (const v of bbLower) if (v != null) extras.push(v);
    if (data?.strike != null) extras.push(data.strike);
    if (data?.upperAtNow != null) extras.push(data.upperAtNow);
    if (data?.lowerAtNow != null) extras.push(data.lowerAtNow);
    let pMin = Math.min(...lows, ...extras);
    let pMax = Math.max(...highs, ...extras);
    const pad = (pMax - pMin) * 0.04;
    pMin -= pad; pMax += pad;

    return {
      candles, e9, e21, e55, e145, e169, vwapSeries, bbUpper, bbLower,
      rsiSeries, macdHist, trend, spikeFlags, pMin, pMax,
    };
  }, [candlesProp, data]);

  // Fibonacci grid — computed from candles currently visible in the viewport.
  // MUST be declared before any early return to keep hook order stable.
  const fibListMemo = useMemo(() => {
    if (!fibOn || !computed) return [];
    const nC = computed.candles.length;
    const el = scrollRef.current;
    let startIdx = 0;
    let endIdx = nC - 1;
    if (el && el.clientWidth > 0) {
      startIdx = Math.max(0, Math.floor((el.scrollLeft - PAD_L) / CANDLE_W));
      endIdx = Math.min(nC - 1, Math.ceil((el.scrollLeft + el.clientWidth - PAD_L) / CANDLE_W));
    }
    if (endIdx <= startIdx) return [];
    let hi = -Infinity, lo = Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const cd = computed.candles[i];
      if (cd.h > hi) hi = cd.h;
      if (cd.l < lo) lo = cd.l;
    }
    if (!isFinite(hi) || !isFinite(lo) || hi <= lo) return [];
    return fibLevels(hi, lo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fibOn, viewportTick, computed, CANDLE_W, tf]);


  // Snap to the right only when the candle count changes (new data),
  // NOT on zoom or every render.
  const prevCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const n = computed?.candles.length ?? 0;
    if (n !== prevCountRef.current) {
      el.scrollLeft = el.scrollWidth;
      prevCountRef.current = n;
    }
  }, [computed]);

  // ── Interactions: drag-to-pan + wheel-to-zoom (anchored under cursor) ──
  const dragRef = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
    el.style.cursor = "grabbing";
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    const d = dragRef.current;
    if (!el || !d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) {
      d.moved = true;
      el.scrollLeft = d.startLeft - dx;
    }
  };
  const endDrag = () => {
    const el = scrollRef.current;
    if (el) el.style.cursor = "grab";
    if (dragRef.current?.moved) suppressClickRef.current = true;
    dragRef.current = null;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressClickRef.current = false;
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    // Horizontal-only pan when Shift held or trackpad horizontal delta present
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      el.scrollLeft += e.deltaX || e.deltaY;
      e.preventDefault();
      return;
    }
    // Vertical wheel = zoom, anchored under the mouse
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const mouseInContainer = e.clientX - rect.left;
    const mouseInContent = mouseInContainer + el.scrollLeft;
    const anchorIdx = (mouseInContent - PAD_L) / candleW;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nw = Math.max(MIN_CW, Math.min(MAX_CW, candleW * factor));
    if (nw === candleW) return;
    setCandleW(nw);
    // Adjust scrollLeft next frame so the anchor stays under the cursor.
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const newContentX = PAD_L + anchorIdx * nw;
      scrollRef.current.scrollLeft = newContentX - mouseInContainer;
    });
  };

  const zoomBy = (factor: number) => {
    const el = scrollRef.current;
    const nw = Math.max(MIN_CW, Math.min(MAX_CW, candleW * factor));
    if (nw === candleW) return;
    // Anchor to the right edge (where the current candle is).
    const rightAnchorIdx = el
      ? ((el.scrollLeft + el.clientWidth) - PAD_L) / candleW
      : 0;
    setCandleW(nw);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const newContentX = PAD_L + rightAnchorIdx * nw;
      scrollRef.current.scrollLeft = newContentX - scrollRef.current.clientWidth;
    });
  };
  const resetZoom = () => {
    setCandleW(DEFAULT_CW);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    });
  };

  if (!computed) {
    return <div className="h-[320px] mt-2 flex items-center justify-center text-xs text-white/40">Loading chart…</div>;
  }

  const c = computed;
  const nCandles = c.candles.length;
  const innerW = PAD_L + PAD_R + (nCandles + FUTURE_SLOTS) * CANDLE_W;
  const lastCandleX = PAD_L + nCandles * CANDLE_W; // right edge of the last real candle

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
  // (iAtT helper removed — trendlines rendered via slope/intercept directly)
  const upper = c.trend.upper;
  const lower = c.trend.lower;

  const fibList = fibListMemo;


  const onScroll = () => setViewportTick(v => (v + 1) & 0xffff);

  return (
    <div className="relative mt-2">
      {/* Zoom controls — overlay top-right */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1 py-0.5 backdrop-blur">
        <button
          onClick={() => zoomBy(1 / 1.25)}
          className="w-6 h-6 text-white/70 hover:text-white text-sm leading-none"
          title="Zoom out"
        >−</button>
        <span className="text-[9px] text-white/40 font-mono tabular-nums w-8 text-center">
          {(candleW / DEFAULT_CW).toFixed(2)}×
        </span>
        <button
          onClick={() => zoomBy(1.25)}
          className="w-6 h-6 text-white/70 hover:text-white text-sm leading-none"
          title="Zoom in"
        >+</button>
        <button
          onClick={resetZoom}
          className="px-1.5 h-6 text-[10px] text-white/60 hover:text-white font-mono"
          title="Reset zoom & scroll to now"
        >reset</button>
      </div>
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden border border-white/5 rounded bg-black/30 select-none"
        style={{ cursor: "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onClickCapture={onClickCapture}
        onWheel={onWheel}
        onScroll={onScroll}
      >
      <svg
        width={innerW}
        height={priceH + rsiH + macdH + 24}
        className="block"
      >
        {/* ── Price panel ── */}
        <g>
          {/* Fibonacci retracement grid — from currently visible viewport */}
          {fibList.map((lvl, i) => {
            if (lvl.price < c.pMin || lvl.price > c.pMax) return null;
            const y = yPrice(lvl.price);
            const stroke = FIB_COLORS[lvl.label] ?? "rgba(148, 163, 184, 0.5)";
            return (
              <g key={`fib-${i}`}>
                <line
                  x1={PAD_L} y1={y} x2={innerW - PAD_R} y2={y}
                  stroke={stroke} strokeWidth={1}
                  strokeDasharray={lvl.kind === "ext" ? "6 6" : "3 4"}
                  opacity={lvl.ratio === 0.5 || lvl.ratio === 0.618 ? 0.95 : 0.7}
                />
                <text
                  x={PAD_L + 4} y={y - 2}
                  fill={stroke} fontSize={9} fontFamily="monospace"
                >
                  {lvl.label} · ${lvl.price.toFixed(lvl.price > 10_000 ? 0 : 2)}
                </text>
              </g>
            );
          })}

          {/* future/empty zone shading (right of the current candle) */}
          <rect
            x={lastCandleX} y={PAD_T}
            width={Math.max(0, innerW - PAD_R - lastCandleX)}
            height={priceH - PAD_T}
            fill="rgba(255,255,255,0.015)"
          />
          {/* "now" vertical divider between last candle and upcoming space */}
          <line
            x1={lastCandleX} y1={PAD_T} x2={lastCandleX} y2={priceH - PAD_B}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="2 3"
          />
          <text
            x={lastCandleX + 4} y={PAD_T + 10}
            fill="rgba(255,255,255,0.4)" fontSize={9} fontFamily="monospace"
          >
            now →
          </text>
          {/* horizontal grid — extends into the future zone so it feels continuous */}
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
            const isSel = selectedIdx === i;
            return (
              <g key={i} onClick={(e) => { e.stopPropagation(); setSelectedIdx(i); }} style={{ cursor: "pointer" }}>
                {/* invisible wide hitbox so tiny candles are still easy to click */}
                <rect
                  x={cx - CANDLE_W / 2} y={PAD_T}
                  width={CANDLE_W} height={priceH - PAD_T - PAD_B}
                  fill="transparent"
                />
                <line x1={cx} y1={yPrice(cd.h)} x2={cx} y2={yPrice(cd.l)}
                  stroke={color} strokeWidth={1} opacity={0.75} />
                <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW}
                  height={Math.max(1, bodyBot - bodyTop)} fill={color} opacity={0.9} />
                {isSel && (
                  <rect
                    x={cx - CANDLE_W / 2} y={PAD_T}
                    width={CANDLE_W} height={priceH - PAD_T - PAD_B}
                    fill="rgba(255,255,255,0.06)"
                    stroke="rgba(255,255,255,0.5)" strokeWidth={0.8}
                  />
                )}
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

          {/* strike line — bold, labeled on BOTH ends with target price pill on right */}
          {data?.strike != null && data.strike >= c.pMin && data.strike <= c.pMax && (
            <>
              <line
                x1={PAD_L} y1={yPrice(data.strike)}
                x2={innerW - PAD_R} y2={yPrice(data.strike)}
                stroke="rgb(255,255,255)" strokeWidth={1.4} strokeDasharray="6 4" opacity={0.85}
              />
              {/* left pill: STRIKE label */}
              <rect
                x={PAD_L + 4} y={yPrice(data.strike) - 10}
                width={110} height={16} rx={3}
                fill="rgba(2, 132, 199, 0.9)"
              />
              <text
                x={PAD_L + 10} y={yPrice(data.strike) + 2}
                fill="white" fontSize={11} fontFamily="monospace" fontWeight={700}
              >
                ${data.strike.toFixed(2)} target
              </text>
              {/* right pill: matching y-axis tag */}
              <rect
                x={innerW - PAD_R + 2} y={yPrice(data.strike) - 9}
                width={PAD_R - 4} height={18} rx={3}
                fill="rgba(2, 132, 199, 0.95)" stroke="rgba(255,255,255,0.4)"
              />
              <text
                x={innerW - 6} y={yPrice(data.strike) + 3} textAnchor="end"
                fill="white" fontSize={11} fontFamily="monospace" fontWeight={700}
              >
                ${data.strike.toFixed(2)}
              </text>
            </>
          )}

          {/* current price marker on the right edge — colored by direction vs strike */}
          {(() => {
            const last = c.candles[nCandles - 1];
            const prev = c.candles[nCandles - 2] ?? last;
            const yy = yPrice(last.c);
            // Green if above strike (or rising), red if below strike (or falling)
            const aboveStrike = data?.strike != null ? last.c >= data.strike : last.c >= prev.c;
            const up = aboveStrike;
            const fill = up ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)";
            const dashStroke = up ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.7)";
            const diff = data?.strike != null ? last.c - data.strike : null;
            const diffText = diff != null
              ? `${diff >= 0 ? "+" : ""}$${diff.toFixed(2)} ${diff >= 0 ? "above" : "below"} strike`
              : "";
            return (
              <>
                <line
                  x1={PAD_L} y1={yy} x2={innerW - PAD_R} y2={yy}
                  stroke={dashStroke} strokeWidth={1.2} strokeDasharray="4 4"
                />
                {/* pulse dot at last candle */}
                <circle cx={xFor(nCandles - 1)} cy={yy} r={5} fill={fill} opacity={0.35} />
                <circle cx={xFor(nCandles - 1)} cy={yy} r={3} fill={fill} />
                {/* right-axis price pill */}
                <rect
                  x={innerW - PAD_R + 2} y={yy - 9} width={PAD_R - 4} height={18} rx={3}
                  fill={fill} stroke="rgba(0,0,0,0.4)"
                />
                <text
                  x={innerW - 6} y={yy + 3} textAnchor="end"
                  fill="white" fontSize={11} fontFamily="monospace" fontWeight={700}
                >
                  ${last.c.toFixed(2)}
                </text>
                {/* amount above/below strike tag floating just left of the price pill */}
                {diffText && (
                  <>
                    <rect
                      x={innerW - PAD_R - 118} y={yy - 8} width={114} height={16} rx={3}
                      fill="rgba(0,0,0,0.65)" stroke={dashStroke} strokeWidth={1}
                    />
                    <text
                      x={innerW - PAD_R - 8} y={yy + 3} textAnchor="end"
                      fill={up ? "rgb(134, 239, 172)" : "rgb(252, 165, 165)"}
                      fontSize={10} fontFamily="monospace" fontWeight={600}
                    >
                      {diffText}
                    </text>
                  </>
                )}
              </>
            );
          })()}

          {/* selected candle: vertical guide + OHLC tooltip */}
          {selectedIdx != null && selectedIdx >= 0 && selectedIdx < nCandles && (() => {
            const cd = c.candles[selectedIdx];
            const prev = c.candles[selectedIdx - 1] ?? cd;
            const cx = xFor(selectedIdx);
            const change = cd.c - prev.c;
            const changePct = prev.c ? (change / prev.c) * 100 : 0;
            const up = change >= 0;
            const boxW = 168, boxH = 118;
            // flip tooltip to the left if it would overflow the right edge
            const rightEdge = innerW - PAD_R;
            const flip = cx + boxW + 10 > rightEdge;
            const bx = flip ? cx - boxW - 10 : cx + 10;
            const by = PAD_T + 8;
            const time = new Date(cd.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const date = new Date(cd.t).toLocaleDateString([], { month: "short", day: "numeric" });
            const rows: Array<[string, string, string?]> = [
              ["O", `$${cd.o.toFixed(2)}`],
              ["H", `$${cd.h.toFixed(2)}`, "rgb(74, 222, 128)"],
              ["L", `$${cd.l.toFixed(2)}`, "rgb(248, 113, 113)"],
              ["C", `$${cd.c.toFixed(2)}`, up ? "rgb(74, 222, 128)" : "rgb(248, 113, 113)"],
              ["Δ", `${change >= 0 ? "+" : ""}$${change.toFixed(2)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`, up ? "rgb(134, 239, 172)" : "rgb(252, 165, 165)"],
              ["Vol", cd.v != null ? cd.v.toFixed(3) : "—"],
            ];
            return (
              <g style={{ pointerEvents: "none" }}>
                <line x1={cx} y1={PAD_T} x2={cx} y2={priceH - PAD_B}
                  stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2 3" />
                <rect x={bx} y={by} width={boxW} height={boxH} rx={4}
                  fill="rgba(10,10,12,0.94)" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                <text x={bx + 8} y={by + 14} fill="rgba(255,255,255,0.55)"
                  fontSize={10} fontFamily="monospace">{date} · {time} UTC</text>
                {rows.map(([k, v, col], i) => (
                  <g key={k}>
                    <text x={bx + 8} y={by + 32 + i * 14}
                      fill="rgba(255,255,255,0.55)" fontSize={11} fontFamily="monospace">{k}</text>
                    <text x={bx + boxW - 8} y={by + 32 + i * 14} textAnchor="end"
                      fill={col ?? "white"} fontSize={11} fontFamily="monospace" fontWeight={600}>{v}</text>
                  </g>
                ))}
                {/* close button */}
                <g style={{ pointerEvents: "all", cursor: "pointer" }}
                   onClick={(e) => { e.stopPropagation(); setSelectedIdx(null); }}>
                  <rect x={bx + boxW - 18} y={by + 2} width={16} height={14} rx={2}
                    fill="rgba(255,255,255,0.08)" />
                  <text x={bx + boxW - 10} y={by + 13} textAnchor="middle"
                    fill="rgba(255,255,255,0.7)" fontSize={10} fontFamily="monospace">×</text>
                </g>
              </g>
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
    </div>
  );
}
