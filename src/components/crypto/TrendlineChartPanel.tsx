import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { evalTrendlineShadow, type TrendlineSnapshot } from "@/lib/trendlineShadow.functions";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { getCompositeSpot } from "@/lib/compositeSpot.functions";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { getBtcCandles, TF_LIST, type CandleTf } from "@/lib/btcCandles.functions";
import { detectSpike, detectTrendlines, type TCandle } from "@/lib/ta/trendlines";
import { emaSeries, rsi, macd, bollinger, sessionVwap } from "@/lib/ta/taEngine";
import { fibLevels, FIB_COLORS } from "@/lib/ta/fib";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { OurOddsPill } from "@/components/crypto/OurOddsPill";
import { computeOurQuote, realizedVolFromCloses, toAmericanOdds } from "@/lib/ourOdds";
import { useOurQuote } from "@/hooks/useOurQuote";
import { useKalshiOddsRecorder } from "@/hooks/useKalshiOddsRecorder";

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
  const compositeFn = useServerFn(getCompositeSpot);
  const spotVolFn = useServerFn(getBtcSpotVolume);

  // Records 1 snapshot/sec of Kalshi odds + our odds into btc_kalshi_odds_snapshots.
  useKalshiOddsRecorder([]);

  // Retained last-good UP/DN quote for the pulse-dot pills — prevents blink
  // when sigma / candles / kalshi momentarily go null between frames.
  const lastQuoteRef = useRef<ReturnType<typeof computeOurQuote> | null>(null);



  // Live composite BTC spot from Binance+Coinbase WebSockets (~50–200ms/tick).
  // This is the fastest source and drives the price marker + delta pill.
  const live = useLiveCompositeSpot();

  // Server-side composite (median of Coinbase+Binance+Kraken) — polled every
  // 1s. Used only as a fallback when WS hasn't connected yet.
  const { data: composite } = useQuery({
    queryKey: ["composite-spot"],
    queryFn: () => compositeFn(),
    refetchInterval: 1_000,
    staleTime: 800,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
  });


  const { data: kalshiRaw } = useQuery({
    queryKey: ["kalshi-implied-spot"],
    queryFn: () => kalshiFn(),
    refetchInterval: 1_000,
    staleTime: 800,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
  });

  // Stabilize: retain last-good Kalshi payload so transient failures / null
  // frames don't blank the "Kalshi vs ours" pill or the OurOdds pill (which
  // needs `strike` to render).
  const lastGoodKalshiRef = useRef<typeof kalshiRaw | null>(null);
  if (kalshiRaw?.ok && kalshiRaw.strike != null) {
    lastGoodKalshiRef.current = kalshiRaw;
  }
  const kalshi = kalshiRaw?.ok ? kalshiRaw : (lastGoodKalshiRef.current ?? kalshiRaw);

  // Smooth 1s countdown to Kalshi window close. Kalshi refetches every 5s;
  // between refetches we interpolate locally so the timer never freezes.
  // Re-anchor rules (avoid visible drift/jitter):
  //   - ticker rolled → hard reset to new window
  //   - server value is LOWER than our interp by ≥1s → we're behind real time,
  //     snap down (monotonic decrease is fine)
  //   - server value is HIGHER than our interp → ignore (network latency /
  //     server-side second boundary). Re-anchoring up causes the "up and down"
  //     wobble the user reported.
  const kalshiAnchorRef = useRef<{ ticker: string; secs: number; at: number } | null>(null);
  if (kalshi?.ok && kalshi.ticker && typeof kalshi.secondsToClose === "number") {
    const prev = kalshiAnchorRef.current;
    const interp = prev
      ? Math.max(0, prev.secs - Math.floor((Date.now() - prev.at) / 1000))
      : null;
    const rolled = !prev || prev.ticker !== kalshi.ticker;
    const behind = interp != null && kalshi.secondsToClose < interp - 1;
    if (rolled || interp == null || behind) {
      kalshiAnchorRef.current = { ticker: kalshi.ticker, secs: kalshi.secondsToClose, at: Date.now() };
    }
  }
  const [kalshiRemainingSec, setKalshiRemainingSec] = useState<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = kalshiAnchorRef.current;
      if (a) {
        const next = Math.max(0, a.secs - Math.floor((Date.now() - a.at) / 1000));
        setKalshiRemainingSec((prev) => (prev === next ? prev : next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const fmtMMSS = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;


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
  const { data: candlesData, isFetching: candlesFetching, refetch: refetchCandles } = useQuery({
    queryKey: ["btc-candles", tf],
    queryFn: () => candlesFn({ data: { tf, limit: tf === "1m" ? 500 : 300 } }),
    refetchInterval: TF_REFETCH_MS[tf],
    staleTime: TF_REFETCH_MS[tf] - 1_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Live-splice: extend the currently-forming last candle with the freshest
  // spot we have (Kalshi implied @ 5s > shadow composite @ 30s) so the bar
  // visibly ticks up/down between server refetches. Only when the live tick
  // still falls inside the last bar's bucket — never invent a new bar.
  const rawCandles = candlesData?.candles ?? shadow?.candles ?? [];
  // Splice source ticks slowly (server composite @1s) so indicator memos
  // don't recompute on every WS tick.
  const spliceSpot = composite?.spot ?? kalshi?.impliedSpot ?? shadow?.spot ?? null;
  // Display source is the WS live tick (~50–200ms). Falls back to slower feeds.
  const displaySpot = live.spot ?? spliceSpot;

  const candles = useMemo<TCandle[]>(() => {
    if (!rawCandles.length || spliceSpot == null) return rawCandles;
    const bucketMs =
      tf === "1m" ? 60_000 :
      tf === "5m" ? 300_000 :
      tf === "15m" ? 900_000 :
      tf === "1h" ? 3_600_000 :
      86_400_000;
    const last = rawCandles[rawCandles.length - 1];
    const now = Date.now();
    if (now - last.t >= bucketMs) return rawCandles; // bar closed — wait for next fetch
    const patched: TCandle = {
      ...last,
      c: spliceSpot,
      h: Math.max(last.h, spliceSpot),
      l: Math.min(last.l, spliceSpot),
    };
    return [...rawCandles.slice(0, -1), patched];
  }, [rawCandles, spliceSpot, tf]);


  const isFetching = candlesFetching || shadowFetching;
  const refetch = () => { refetchShadow(); refetchCandles(); };


  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SERIES.map(s => [s.key, s.defaultOn]))
  );

  // Single source of truth for OUR UP/DOWN quote — shared by the top OURS
  // pill and the pulse-dot pills on the chart so they always match.
  const closes1mForOdds = useMemo<number[]>(() => (
    tf === "1m"
      ? (rawCandles as TCandle[]).map(c => c.c)
      : ((shadow?.candles ?? []) as TCandle[]).map(c => c.c)
  ), [tf, rawCandles, shadow?.candles]);
  const midPriceNow = useMemo<number | null>(() => {
    const u = shadow?.upperAtNow, l = shadow?.lowerAtNow;
    return (u != null && l != null && u > l) ? (u + l) / 2 : null;
  }, [shadow?.upperAtNow, shadow?.lowerAtNow]);
  // Spot taker buy/sell imbalance — small confirming weight on the study pick.
  const { data: spotVol } = useQuery({
    queryKey: ["btc-spot-volume-quote"],
    queryFn: () => spotVolFn(),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
  const volImb3m = spotVol?.m3?.imbalance ?? null;

  const ourQuote = useOurQuote({
    spot: displaySpot,
    strike: kalshi?.strike ?? null,
    secondsToClose: kalshiRemainingSec,
    closes1m: closes1mForOdds,
    midPrice: midPriceNow,
    buyPrice: shadow?.upperAtNow ?? null,
    sellPrice: shadow?.lowerAtNow ?? null,
    volumeImbalance3m: volImb3m,
  });

  // --- BET UP/DOWN lock @ 75% within first 7 min (session-only W/L history) -------------------
  // Once the recommendation chip hits ≥75% conf inside the first 7 min of the
  // window, freeze that side for the rest of the window AND persist it to
  // btc_model_predictions.study_locked_side (overrides server-side Study Pick).
  // Lock releases when the strike rolls to the next 15m window.
  type RecoLock = { strike: number; side: "UP" | "DOWN"; lockedAt: number; lockedConf: number };
  type RecoOutcome = { side: "UP" | "DOWN"; won: boolean; strike: number; settleSpot: number };
  const [recoLock, setRecoLock] = useState<RecoLock | null>(null);
  const [recoHistory, setRecoHistory] = useState<RecoOutcome[]>([]);
  const lastSpotRef = useRef<number | null>(null);
  const chipPickWrittenRef = useRef<string | null>(null); // ticker we've already written
  // Late-lock candidate: side that's been ≥80% conf continuously; commits at 120s held.
  const lateCandRef = useRef<{ ticker: string; side: "UP" | "DOWN"; since: number } | null>(null);
  useEffect(() => { if (displaySpot != null) lastSpotRef.current = displaySpot; }, [displaySpot]);

  const currentStrike = shadow?.strike ?? null;
  const currentTicker = shadow?.ticker ?? null;
  const recLive = ourQuote?.recommendation ?? null;
  const secondsToCloseForLock = kalshiRemainingSec ?? null;
  // EARLY path: 7-min mark (secondsToClose in (420, 480]) at ≥75%.
  const inEarlyWindow = secondsToCloseForLock != null && secondsToCloseForLock <= 480 && secondsToCloseForLock > 420;
  // LATE path: after minute 8, before T-180, at ≥80% held 120s continuously.
  const inLateWindow  = secondsToCloseForLock != null && secondsToCloseForLock <= 420 && secondsToCloseForLock >= 180;
  const LATE_CONF = 80;
  const LATE_HOLD_MS = 120_000;
  useEffect(() => {
    // Strike changed → settle any open lock, then clear candidate.
    if (recoLock && currentStrike != null && currentStrike !== recoLock.strike) {
      const settle = lastSpotRef.current;
      if (settle != null && Number.isFinite(settle)) {
        const won = recoLock.side === "UP" ? settle > recoLock.strike : settle < recoLock.strike;
        setRecoHistory(h => [...h, { side: recoLock.side, won, strike: recoLock.strike, settleSpot: settle }].slice(-10));
      }
      setRecoLock(null);
      lateCandRef.current = null;
      return;
    }
    if (recoLock || !recLive || !currentStrike || !currentTicker || secondsToCloseForLock == null) return;

    // EARLY arm: ≥75% inside 7-min mark.
    if (recLive.side !== "WAIT" && recLive.confidencePct >= 75 && inEarlyWindow) {
      setRecoLock({ strike: currentStrike, side: recLive.side, lockedAt: Date.now(), lockedConf: recLive.confidencePct });
      if (chipPickWrittenRef.current !== currentTicker) {
        chipPickWrittenRef.current = currentTicker;
        import("@/lib/chipStudyPick.functions").then(({ recordChipStudyPick }) =>
          recordChipStudyPick({
            data: {
              ticker: currentTicker,
              side: recLive.side as "UP" | "DOWN",
              confidencePct: recLive.confidencePct,
              secondsToClose: Math.round(secondsToCloseForLock),
            },
          }).catch(() => {})
        );
      }
      return;
    }

    // LATE arm: ≥80% held 120s continuously inside [T-420, T-180].
    if (inLateWindow && recLive.side !== "WAIT" && recLive.confidencePct >= LATE_CONF) {
      const cand = lateCandRef.current;
      const now = Date.now();
      if (!cand || cand.ticker !== currentTicker || cand.side !== recLive.side) {
        lateCandRef.current = { ticker: currentTicker, side: recLive.side as "UP" | "DOWN", since: now };
      } else if (now - cand.since >= LATE_HOLD_MS) {
        setRecoLock({ strike: currentStrike, side: recLive.side, lockedAt: now, lockedConf: recLive.confidencePct });
        if (chipPickWrittenRef.current !== currentTicker) {
          chipPickWrittenRef.current = currentTicker;
          import("@/lib/chipStudyPick.functions").then(({ recordChipStudyPick }) =>
            recordChipStudyPick({
              data: {
                ticker: currentTicker,
                side: recLive.side as "UP" | "DOWN",
                confidencePct: recLive.confidencePct,
                secondsToClose: Math.round(secondsToCloseForLock),
              },
            }).catch(() => {})
          );
        }
      }
    } else {
      // Conf dropped below 80 or side flipped → reset the 120s clock.
      if (lateCandRef.current && lateCandRef.current.ticker === currentTicker) {
        lateCandRef.current = null;
      }
    }
  }, [currentStrike, currentTicker, recLive, recoLock, inEarlyWindow, inLateWindow, secondsToCloseForLock]);

  // ---- Study Pick Auto-Bet (real-money) retry loop.
  // Server enforces toggle_off / no_keys / already_fired / ask≥90¢ / T-60s cutoff.
  // We just poll every 10s once a chip lock exists for this ticker.
  const autoLiveFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!recoLock || !currentTicker) return;
    if (autoLiveFiredRef.current === currentTicker) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const { fireStudyAutoLive } = await import("@/lib/studyAutoLive.functions");
        const r = await fireStudyAutoLive({ data: { ticker: currentTicker } });
        if (r?.fired) {
          autoLiveFiredRef.current = currentTicker;
          const cts = (r as any).contracts ?? 0;
          const ask = (r as any).askCents ?? "?";
          toast.success(`STUDY AUTO-BET → ${recoLock.side} · ${cts}× @ ${ask}¢`, {
            description: `${currentTicker.slice(-16)} · $10 · hold to settle`,
          });
          return;
        }
        const reason = (r as any)?.reason;
        if (reason === "toggle_off" || reason === "no_keys" || reason === "no_lock" || reason === "already_fired" || reason === "retry_window_expired") {
          autoLiveFiredRef.current = currentTicker; // stop polling for this window
        }
      } catch { /* noop, retry on next tick */ }
    };
    tick();
    const iv = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [recoLock, currentTicker]);




  // ---- ~10s side-tick recorder (feeds btc_side_ticks for backfill/analysis)
  const lastTickAtRef = useRef<number>(0);
  useEffect(() => {
    if (!currentTicker || secondsToCloseForLock == null) return;
    if (!recLive) return;
    const now = Date.now();
    if (now - lastTickAtRef.current < 9500) return;
    lastTickAtRef.current = now;
    import("@/lib/sideTick.functions").then(({ recordSideTick }) =>
      recordSideTick({
        data: {
          ticker: currentTicker,
          secondsToClose: Math.round(secondsToCloseForLock),
          closeTime: secondsToCloseForLock != null ? new Date(Date.now() + secondsToCloseForLock * 1000).toISOString() : null,
          spot: displaySpot ?? null,
          strike: currentStrike ?? null,
          midPrice: midPriceNow ?? null,
          buyPrice: shadow?.upperAtNow ?? null,
          sellPrice: shadow?.lowerAtNow ?? null,
          recoSide: (recLive.side as "UP" | "DOWN" | "WAIT"),
          recoConfPct: recLive.confidencePct ?? null,
          memScore: (ourQuote as any)?.memScore ?? null,
          aboveStrikeRatio90s: (ourQuote as any)?.aboveStrikeRatio90s ?? null,
        },
      }).catch(() => {})
    );
  }, [currentTicker, secondsToCloseForLock, recLive, displaySpot, currentStrike, midPriceNow, shadow?.upperAtNow, shadow?.lowerAtNow, ourQuote]);

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
            const ours = displaySpot;
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
                    ? `Kalshi ${kalshi.ticker} · YES mid ${((kalshi.yesMid ?? 0) * 100).toFixed(1)}¢ · strike $${kalshi.strike?.toFixed(0)} · ${kalshi.secondsToClose}s to close · implied spot inverted from YES prob via Φ⁻¹ · live ${live.sources ? `${live.sources}v` : "off"}`
                    : `Kalshi implied spot unavailable${kalshi?.error ? ` — ${kalshi.error}` : ""}`
                }
              >
                <span className="text-white/50">Kalshi</span>
                <span className="tabular-nums">
                  {k != null ? `$${k.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                </span>
                <span className="text-white/40">vs ours</span>
                <span className="tabular-nums">
                  {ours != null ? `$${ours.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
                </span>
                {diff != null && (
                  <span className={`tabular-nums ${diffCls}`}>
                    {diff >= 0 ? "+" : ""}${diff.toFixed(1)}
                  </span>
                )}
                <span className={`ml-1 h-1.5 w-1.5 rounded-full ${live.connected ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
              </span>
            );
          })()}

          {kalshiRemainingSec != null && (() => {
            const s = kalshiRemainingSec;
            const urgent = s <= 30;
            const soon = s <= 120;
            const cls = urgent
              ? "border-rose-500/60 bg-rose-500/15 text-rose-200 animate-pulse"
              : soon
                ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                : "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
            return (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono flex items-center gap-1 ${cls}`}
                title={`Kalshi ${kalshi?.ticker ?? ""} closes in ${s}s`}
              >
                <span className="text-white/50">CLOSES</span>
                <span className="tabular-nums font-bold">{fmtMMSS(s)}</span>
              </span>
            );
          })()}

          <OurOddsPill
            quote={ourQuote}
            kalshiUpProb={kalshi?.yesMid ?? null}
          />








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
          <div className="relative">
            {/* Sticky live-price overlay — always visible, never hidden by scroll */}
            {displaySpot != null && (() => {
              const strike = shadow?.strike ?? null;
              const diff = strike != null ? displaySpot - strike : null;
              const up = diff != null ? diff >= 0 : true;
              const border = diff == null
                ? "border-white/20"
                : up ? "border-emerald-500/60" : "border-rose-500/60";
              const priceCls = diff == null
                ? "text-white"
                : up ? "text-emerald-300" : "text-rose-300";
              const rec = ourQuote?.recommendation ?? null;
              // If a lock is active for this strike, chip is frozen on the locked side.
              const lockActive = recoLock != null && strike != null && recoLock.strike === strike;
              const shownSide: "UP" | "DOWN" | "WAIT" = lockActive
                ? recoLock!.side
                : (rec?.side ?? "WAIT");
              const shownConf = lockActive
                ? Math.max(recoLock!.lockedConf, rec?.side === recoLock!.side ? rec.confidencePct : recoLock!.lockedConf)
                : (rec?.confidencePct ?? 0);
              const shownStrong = lockActive || rec?.strength === "strong";
              const recCls = shownSide === "WAIT"
                ? "border-white/30 bg-white/10 text-white/70"
                : shownSide === "UP"
                  ? (shownStrong ? "border-emerald-400 bg-emerald-500/25 text-emerald-100" : "border-emerald-400/60 bg-emerald-500/10 text-emerald-200")
                  : (shownStrong ? "border-rose-400 bg-rose-500/25 text-rose-100" : "border-rose-400/60 bg-rose-500/10 text-rose-200");
              const recLabel = rec == null && !lockActive
                ? "…"
                : shownSide === "WAIT" ? "WAIT" : `BET ${shownSide}`;
              const recTitle = lockActive
                ? `🔒 Locked ${recoLock!.side} @ ${recoLock!.lockedConf.toFixed(0)}% — releases on next window. Live rec: ${rec?.reason ?? "…"}`
                : (rec?.reason ?? "");
              return (
                <div
                  className={`pointer-events-none absolute top-2 left-2 z-20 flex flex-col items-start gap-1`}
                  aria-label="Live BTC composite spot"
                >
                  <div className={`flex items-center gap-2 px-2 py-1 rounded border ${border} bg-black/75 backdrop-blur font-mono text-[11px] shadow-lg`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${live.connected ? "bg-emerald-400 animate-pulse" : "bg-white/30"}`} />
                    <span className={`tabular-nums ${priceCls}`}>
                      ${displaySpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {diff != null && (
                      <span className={`tabular-nums ${up ? "text-emerald-300" : "text-rose-300"}`}>
                        {up ? "+" : ""}${diff.toFixed(2)} {up ? "above" : "below"} strike
                      </span>
                    )}
                    {(rec || lockActive) && (
                      <span
                        className={`ml-1 px-1.5 py-[1px] rounded border text-[10px] font-bold tracking-wider ${recCls}`}
                        title={recTitle}
                      >
                        {lockActive && <span className="mr-0.5">🔒</span>}
                        {recLabel}
                        {shownSide !== "WAIT" && (
                          <span className="ml-1 opacity-80 font-mono font-normal">
                            {shownConf.toFixed(0)}%
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-white/30">· {live.sources || 0}v</span>
                  </div>
                  {recoHistory.length > 0 && (() => {
                    const wins = recoHistory.filter(o => o.won).length;
                    const wr = (wins / recoHistory.length) * 100;
                    return (
                      <div
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 border border-white/10 backdrop-blur font-mono text-[9px] text-white/60"
                        title={recoHistory.map((o, i) => `#${i + 1} ${o.side} ${o.won ? "WIN" : "LOSS"} @ $${o.strike}`).join(" · ")}
                      >
                        <span className="text-white/40">W/L</span>
                        {recoHistory.map((o, i) => (
                          <span
                            key={i}
                            className={`h-1.5 w-1.5 rounded-full ${o.won ? "bg-emerald-400" : "bg-rose-400"}`}
                          />
                        ))}
                        <span className="ml-0.5 text-white/50 tabular-nums">
                          {wins}/{recoHistory.length} · {wr.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            <TaChart
              candles={candles}
              shadow={shadow ?? null}
              tf={tf}
              visible={visible}
              fibOn={fibOn}
              liveSpot={displaySpot}
              ourUpAskProb={ourQuote?.pUpAsk ?? null}
              ourDownAskProb={ourQuote?.pDownAsk ?? null}
              ourMidProb={ourQuote?.mid ?? null}
              timeDecayFrac={ourQuote?.timeDecayFrac ?? 0}
              midPivotTiltPct={ourQuote?.midPivotTiltPct ?? 0}
              kalshiFlow={{
                yesVol60s: kalshi?.yesVol60s ?? null,
                noVol60s: kalshi?.noVol60s ?? null,
                tradeCount60s: kalshi?.tradeCount60s ?? null,
                volume: kalshi?.volume ?? null,
                openInterest: kalshi?.openInterest ?? null,
                yesVolWindow: kalshi?.yesVolWindow ?? null,
                noVolWindow: kalshi?.noVolWindow ?? null,
                tradeCountWindow: kalshi?.tradeCountWindow ?? null,
                ladder: kalshi?.flowLadder ?? null,
              }}
            />

          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[10px]">
            <Stat label="Spot (live)"   value={displaySpot != null ? `$${displaySpot.toFixed(2)}` : "—"} />
            <Stat label="Strike"        value={shadow?.strike != null ? `$${shadow.strike.toFixed(2)}` : "—"} />
            <Stat
              label="Δ Strike"
              value={
                displaySpot != null && shadow?.strike != null
                  ? `${(displaySpot - shadow.strike) >= 0 ? "+" : ""}$${(displaySpot - shadow.strike).toFixed(2)} ${displaySpot >= shadow.strike ? "above" : "below"}`
                  : "—"
              }
              icon={
                displaySpot != null && shadow?.strike != null ? (
                  displaySpot >= shadow.strike
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
  candles: candlesProp, shadow, tf, visible, fibOn, liveSpot,
  ourUpAskProb, ourDownAskProb, ourMidProb,
  timeDecayFrac, midPivotTiltPct, kalshiFlow,
}: {
  candles: TCandle[];
  shadow: TrendlineSnapshot | null;
  tf: CandleTf;
  visible: Record<string, boolean>;
  fibOn: boolean;
  liveSpot: number | null;
  ourUpAskProb: number | null;
  ourDownAskProb: number | null;
  ourMidProb: number | null;
  timeDecayFrac: number;
  midPivotTiltPct: number;
  kalshiFlow?: {
    yesVol60s: number | null;
    noVol60s: number | null;
    tradeCount60s: number | null;
    volume: number | null;
    openInterest: number | null;
    yesVolWindow: number | null;
    noVolWindow: number | null;
    tradeCountWindow: number | null;
    ladder: Array<{ m: number; yes: number; no: number; trades: number }> | null;
  };
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
    <>
      {(() => {
        // Kalshi per-side flow strip — sits above the trendline chart section.
        const y = kalshiFlow?.yesVol60s ?? null;
        const n = kalshiFlow?.noVol60s ?? null;
        const oi = kalshiFlow?.openInterest ?? null;
        const vol = kalshiFlow?.volume ?? null;
        const trades = kalshiFlow?.tradeCount60s ?? 0;
        const wy = kalshiFlow?.yesVolWindow ?? null;
        const wn = kalshiFlow?.noVolWindow ?? null;
        const wTrades = kalshiFlow?.tradeCountWindow ?? 0;
        const ladder = kalshiFlow?.ladder ?? null;
        const wHas = wy != null && wn != null && (wy + wn) > 0;
        const wTotal = wHas ? (wy as number) + (wn as number) : 0;
        const wYesPct = wTotal > 0 ? ((wy as number) / wTotal) * 100 : 0;
        const wNoPct = 100 - wYesPct;
        const wDominant: "YES" | "NO" | null =
          wTotal >= 20 && wYesPct >= 60 ? "YES"
          : wTotal >= 20 && wNoPct >= 60 ? "NO"
          : null;
        const hasData = y != null && n != null;
        const total = hasData ? (y as number) + (n as number) : 0;
        const yesPct = total > 0 ? ((y as number) / total) * 100 : 0;
        const noPct = 100 - yesPct;
        const dominant: "YES" | "NO" | null =
          total >= 5 && yesPct >= 65 ? "YES"
          : total >= 5 && noPct >= 65 ? "NO"
          : null;
        const barCls =
          dominant === "YES" ? "border-emerald-500/40 bg-emerald-500/10"
          : dominant === "NO" ? "border-rose-500/40 bg-rose-500/10"
          : "border-white/10 bg-black/40";
        const title =
          `Kalshi taker flow (last 60s):\n` +
          `  YES buys: ${y ?? "—"} contracts (${hasData ? yesPct.toFixed(0) : "—"}%)\n` +
          `  NO  buys: ${n ?? "—"} contracts (${hasData ? noPct.toFixed(0) : "—"}%)\n` +
          `  Trades:   ${trades}\n` +
          (vol != null ? `  Total window volume: ${vol.toLocaleString()}\n` : "") +
          (oi != null ? `  Open interest: ${oi.toLocaleString()}\n` : "") +
          (wHas
            ? `\nWindow-to-date (since window open):\n` +
              `  YES: ${wy} (${wYesPct.toFixed(0)}%)  NO: ${wn} (${wNoPct.toFixed(0)}%)  ${wTrades} trades\n` +
              (ladder && ladder.length
                ? `  Per-minute ladder (m: YES/NO):\n` +
                  ladder.map((b) => `    m${b.m}: ${b.yes}/${b.no}`).join("\n") + `\n`
                : "")
            : "") +
          (dominant
            ? `\n⚠ ${dominant} side dominant in the last 60s — real money pushing that way.`
            : `\nBalanced 60s flow — no side pressure.`) +
          (wDominant ? `\n⚠ ${wDominant} side dominant across the whole window.` : "");
        return (
          <div
            className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-3 py-2 border rounded text-[10px] font-mono backdrop-blur bg-black/75 shadow-lg ${barCls}`}
            title={title}
          >
            <div className="flex items-center gap-2">
            <span className="text-white/50 tracking-wider">FLOW 60s</span>
            {hasData ? (
              <>
                <span className="flex items-center gap-1">
                  <span className="text-emerald-300/80">Y</span>
                  <span className="tabular-nums text-emerald-200 font-bold">{y}</span>
                </span>
                <span className="text-white/20">·</span>
                <span className="flex items-center gap-1">
                  <span className="text-rose-300/80">N</span>
                  <span className="tabular-nums text-rose-200 font-bold">{n}</span>
                </span>
                <span className="h-1.5 w-[80px] rounded overflow-hidden bg-white/10 flex">
                  <span
                    className="h-full bg-emerald-400/80"
                    style={{ width: `${yesPct}%` }}
                  />
                  <span
                    className="h-full bg-rose-400/80"
                    style={{ width: `${noPct}%` }}
                  />
                </span>
                {dominant && (
                  <span
                    className={`font-bold ${
                      dominant === "YES" ? "text-emerald-200" : "text-rose-200"
                    }`}
                  >
                    {dominant === "YES" ? "↑" : "↓"} {Math.max(yesPct, noPct).toFixed(0)}%
                  </span>
                )}
                <span className="text-white/40">· {trades}t</span>
              </>
            ) : (
              <span className="text-white/40">no data</span>
            )}
            {vol != null && (
              <span className="text-white/40 hidden lg:inline">
                · vol {vol.toLocaleString()}
                {oi != null ? ` · OI ${oi.toLocaleString()}` : ""}
              </span>
            )}
            </div>

            <div className="flex items-center gap-2 border-t sm:border-t-0 border-white/10 pt-1 sm:pt-0">
              <span className="text-white/50 tracking-wider">WIN 15m</span>
              {wHas ? (
                <>
                  <span className="flex items-center gap-1">
                    <span className="text-emerald-300/80">Y</span>
                    <span className="tabular-nums text-emerald-200 font-bold">
                      {(wy as number).toLocaleString()}
                    </span>
                  </span>
                  <span className="text-white/20">·</span>
                  <span className="flex items-center gap-1">
                    <span className="text-rose-300/80">N</span>
                    <span className="tabular-nums text-rose-200 font-bold">
                      {(wn as number).toLocaleString()}
                    </span>
                  </span>
                  <span className="h-1.5 w-[80px] rounded overflow-hidden bg-white/10 flex">
                    <span className="h-full bg-emerald-400/80" style={{ width: `${wYesPct}%` }} />
                    <span className="h-full bg-rose-400/80" style={{ width: `${wNoPct}%` }} />
                  </span>
                  {wDominant && (
                    <span className={`font-bold ${wDominant === "YES" ? "text-emerald-200" : "text-rose-200"}`}>
                      {wDominant === "YES" ? "↑" : "↓"} {Math.max(wYesPct, wNoPct).toFixed(0)}%
                    </span>
                  )}
                  <span className="text-white/40">· {wTrades}t</span>
                  {ladder && ladder.length > 0 && (() => {
                    const peak = Math.max(1, ...ladder.map((b) => b.yes + b.no));
                    return (
                      <span className="hidden lg:flex items-end gap-[2px] h-4 ml-1">
                        {ladder.map((b) => {
                          const h = Math.max(2, Math.round(((b.yes + b.no) / peak) * 14));
                          const yFrac = (b.yes + b.no) > 0 ? b.yes / (b.yes + b.no) : 0.5;
                          return (
                            <span
                              key={b.m}
                              className="w-[3px] flex flex-col justify-end rounded-sm overflow-hidden bg-white/5"
                              style={{ height: `${h}px` }}
                            >
                              <span className="w-full bg-emerald-400/80" style={{ height: `${yFrac * 100}%` }} />
                              <span className="w-full bg-rose-400/80" style={{ height: `${(1 - yFrac) * 100}%` }} />
                            </span>
                          );
                        })}
                      </span>
                    );
                  })()}
                </>
              ) : (
                <span className="text-white/40">accumulating…</span>
              )}
            </div>
          </div>
        );
      })()}
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

          {/* trendlines + SELL/MID/BUY pills stacked to the right of the last candle */}
          {(() => {
            const tPW = 78, tPH = 15;
            const mPW = 92, mPH = 16;
            const xRight = xFor(nCandles - 1);
            // stack column just right of the last real candle, before strike-pill gutter
            const gutter = 8;
            const stackX = Math.min(innerW - PAD_R - Math.max(tPW, mPW) - 2, lastCandleX + gutter);

            const sellPrice = upper ? upper.slope * tN + upper.intercept : null;
            const buyPrice  = lower ? lower.slope * tN + lower.intercept : null;
            const midPrice  = (sellPrice != null && buyPrice != null) ? (sellPrice + buyPrice) / 2 : null;

            // Base stack anchor: MID price y (or last-candle close y if no mid).
            const lastClose = c.candles[nCandles - 1].c;
            const baseY = midPrice != null ? yPrice(midPrice) : yPrice(lastClose);
            const spacing = 22; // vertical spacing between pills

            // Clamp stack inside plot
            const clampY = (y: number, h: number) =>
              Math.max(PAD_T + 2, Math.min(priceH - PAD_B - 2 - h, y));

            const sellY = clampY(baseY - spacing - tPH,  tPH);
            const midY  = clampY(baseY - mPH / 2,        mPH);
            const buyY  = clampY(baseY + spacing,        tPH);

            const renderTrendPill = (
              kind: "SELL" | "BUY",
              yStart: number, priceEnd: number, pillY: number,
            ) => {
              const isSell = kind === "SELL";
              const color  = isSell ? "rgb(239, 68, 68)" : "rgb(34, 197, 94)";
              const fill   = isSell ? "rgba(239,68,68,0.9)" : "rgba(34,197,94,0.9)";
              const stroke = isSell ? "rgba(239,68,68,0.95)" : "rgba(34,197,94,0.95)";
              const pillCenterY = pillY + tPH / 2;
              return (
                <g>
                  <line
                    x1={xFor(0)} y1={yStart}
                    x2={stackX} y2={pillCenterY}
                    stroke={color} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.85}
                  />
                  <rect x={stackX} y={pillY} width={tPW} height={tPH} rx={3}
                    fill={fill} stroke={stroke} strokeWidth={1} />
                  <text x={stackX + 5} y={pillY + tPH - 4}
                    fill="white" fontSize={10} fontFamily="monospace" fontWeight={700}>{kind}</text>
                  <text x={stackX + tPW - 5} y={pillY + tPH - 4} textAnchor="end"
                    fill="white" fontSize={10} fontFamily="monospace" fontWeight={700}
                    className="tabular-nums">${priceEnd.toFixed(0)}</text>
                </g>
              );
            };

            return (
              <>
                {upper && renderTrendPill(
                  "SELL",
                  yPrice(upper.slope * t0 + upper.intercept),
                  sellPrice as number,
                  sellY,
                )}
                {lower && renderTrendPill(
                  "BUY",
                  yPrice(lower.slope * t0 + lower.intercept),
                  buyPrice as number,
                  buyY,
                )}
                {midPrice != null && (() => {
                  const midStart = ((upper!.slope * t0 + upper!.intercept) + (lower!.slope * t0 + lower!.intercept)) / 2;
                  const pillCenterY = midY + mPH / 2;
                  return (
                    <g data-testid="pill-midline-support">
                      <line
                        x1={xFor(0)} y1={yPrice(midStart)}
                        x2={stackX} y2={pillCenterY}
                        stroke="rgb(250, 204, 21)" strokeWidth={1.5}
                        strokeDasharray="6 3" opacity={0.95}
                      />
                      <rect x={stackX} y={midY} width={mPW} height={mPH} rx={3}
                        fill="rgba(250, 204, 21, 0.95)"
                        stroke="rgb(202, 138, 4)" strokeWidth={1} />
                      <text x={stackX + 6} y={midY + mPH - 4.5}
                        fill="rgb(24, 24, 27)" fontSize={10} fontFamily="monospace" fontWeight={800}>
                        MID
                      </text>
                      <text x={stackX + mPW - 5} y={midY + mPH - 4.5} textAnchor="end"
                        fill="rgb(24, 24, 27)" fontSize={10} fontFamily="monospace" fontWeight={800}
                        className="tabular-nums">${midPrice.toFixed(0)}</text>
                    </g>
                  );
                })()}
              </>
            );
          })()}



          {/* BUY/SELL touch markers: candles whose wick tags a trendline */}
          {c.candles.map((cd, i) => {
            const tol = (c.pMax - c.pMin) * 0.005; // ~0.5% of visible range
            const upperP = upper ? upper.slope * cd.t + upper.intercept : null;
            const lowerP = lower ? lower.slope * cd.t + lower.intercept : null;
            const sellTouch = upperP != null && cd.h >= upperP - tol && cd.h <= upperP + tol * 2;
            const buyTouch = lowerP != null && cd.l <= lowerP + tol && cd.l >= lowerP - tol * 2;
            if (!sellTouch && !buyTouch) return null;
            const cx = xFor(i);
            return (
              <g key={`tt-${i}`} pointerEvents="none">
                {sellTouch && upperP != null && (
                  <>
                    <polygon
                      points={`${cx - 4},${yPrice(upperP) - 8} ${cx + 4},${yPrice(upperP) - 8} ${cx},${yPrice(upperP) - 2}`}
                      fill="rgb(239, 68, 68)" stroke="rgba(0,0,0,0.6)" strokeWidth={0.5}
                    />
                    <text x={cx} y={yPrice(upperP) - 10} textAnchor="middle"
                      fill="rgb(239, 68, 68)" fontSize={8} fontWeight={700}>S</text>
                  </>
                )}
                {buyTouch && lowerP != null && (
                  <>
                    <polygon
                      points={`${cx - 4},${yPrice(lowerP) + 8} ${cx + 4},${yPrice(lowerP) + 8} ${cx},${yPrice(lowerP) + 2}`}
                      fill="rgb(34, 197, 94)" stroke="rgba(0,0,0,0.6)" strokeWidth={0.5}
                    />
                    <text x={cx} y={yPrice(lowerP) + 18} textAnchor="middle"
                      fill="rgb(34, 197, 94)" fontSize={8} fontWeight={700}>B</text>
                  </>
                )}
              </g>
            );
          })}


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
                data-testid="pill-strike-target"
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
            // Prefer the WS live tick over the (possibly seconds-stale) last candle close.
            const nowPrice = liveSpot != null && Number.isFinite(liveSpot) ? liveSpot : last.c;
            // Clamp Y so the marker stays visible when the live price briefly
            // exits the current price range (rare during a fast spike).
            const clampedY = Math.max(PAD_T, Math.min(priceH - PAD_B, yPrice(nowPrice)));
            const yy = clampedY;
            const aboveStrike = data?.strike != null ? nowPrice >= data.strike : nowPrice >= prev.c;
            const up = aboveStrike;
            const fill = up ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)";
            const dashStroke = up ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.7)";
            const diff = data?.strike != null ? nowPrice - data.strike : null;
            const diffText = diff != null
              ? `${diff >= 0 ? "+" : ""}$${diff.toFixed(2)} ${diff >= 0 ? "above" : "below"} strike`
              : "";
              // Pin the delta pill to the TOP of the plot area so it never
              // overlaps the UP/DN BUY/SELL pills that sit next to the price.
              const dotX = xFor(nCandles - 1);
              const pillW = 148;
              const pillH = 18;
              // Center horizontally in the plot area (between left pad and right axis).
              const plotLeft = PAD_L + 4;
              const plotRight = innerW - PAD_R - 4;
              const pillX = Math.max(plotLeft, Math.min(plotRight - pillW, (plotLeft + plotRight) / 2 - pillW / 2));
              const pillTextX = pillX + pillW / 2;
              const pillCenterY = PAD_T + pillH / 2 + 2;
              const strikeY = data?.strike != null ? yPrice(data.strike) : null;


            return (
              <>
                <line
                  x1={PAD_L} y1={yy} x2={innerW - PAD_R} y2={yy}
                  stroke={dashStroke} strokeWidth={1.2} strokeDasharray="4 4"
                />
                {/* pulse dot at last candle */}
                <circle cx={dotX} cy={yy} r={6} fill={fill} opacity={0.28}>
                  <animate attributeName="r" values="4;9;4" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.45;0.05;0.45" dur="1.2s" repeatCount="indefinite" />
                </circle>
                <circle cx={dotX} cy={yy} r={3.2} fill={fill} />
                {/* right-axis price pill */}
                <rect
                  data-testid="pill-price-now"
                  x={innerW - PAD_R + 2} y={yy - 9} width={PAD_R - 4} height={18} rx={3}
                  fill={fill} stroke="rgba(0,0,0,0.4)"
                />
                <text
                  x={innerW - 6} y={yy + 3} textAnchor="end"
                  fill="white" fontSize={11} fontFamily="monospace" fontWeight={700}
                >
                  ${nowPrice.toFixed(2)}
                </text>
                {/* delta-from-strike pill — pinned to top-center of the plot area */}
                {diffText && (
                  <>
                    {/* thin connector from the strike line down to the pinned pill */}
                    {strikeY != null && (
                      <line
                        x1={pillX + pillW / 2}
                        y1={pillCenterY + pillH / 2}
                        x2={pillX + pillW / 2}
                        y2={strikeY}
                        stroke={dashStroke} strokeWidth={1} strokeDasharray="2 2" opacity={0.45}
                      />
                    )}
                    <rect
                      data-testid="pill-delta"
                      x={pillX} y={pillCenterY - pillH / 2} width={pillW} height={pillH} rx={3}
                      fill="rgba(0,0,0,0.9)" stroke={dashStroke} strokeWidth={1}
                    />
                    <text
                      x={pillTextX} y={pillCenterY + 4} textAnchor="middle"
                      fill={up ? "rgb(134, 239, 172)" : "rgb(252, 165, 165)"}
                      fontSize={11} fontFamily="monospace" fontWeight={700}
                    >
                      {diffText}
                    </text>
                  </>
                )}



                {/* UP / DOWN odds pills — anchored to the right of the pulse dot */}
                {ourUpAskProb != null && ourDownAskProb != null && (() => {
                  const upStr = toAmericanOdds(ourUpAskProb);
                  const dnStr = toAmericanOdds(ourDownAskProb);
                  const upFav = (ourMidProb ?? 0.5) >= 0.5;
                  const oPW = 70, oPH = 14, oGap = 8, oVGap = 6;
                  const rightLimit = innerW - PAD_R - 4;
                  // sit to the right of the stacked SELL/MID/BUY pills (max width 92)
                  const stackMaxW = 92, stackGutter = 8;
                  const stackRight = Math.min(innerW - PAD_R - stackMaxW - 2, lastCandleX + stackGutter) + stackMaxW;
                  const oX = Math.min(Math.max(dotX + oGap, stackRight + oGap), rightLimit - oPW);

                  // vertical: stack around the price line, but clamp inside plot area
                  let upY = yy - oVGap - oPH;
                  let dnY = yy + oVGap;
                  if (upY < PAD_T + 2) upY = PAD_T + 2;
                  if (dnY + oPH > priceH - PAD_B - 2) dnY = priceH - PAD_B - 2 - oPH;
                  const upFill = upFav ? "rgba(16,185,129,0.85)" : "rgba(0,0,0,0.8)";
                  const upStroke = upFav ? "rgba(16,185,129,0.9)" : "rgba(148,163,184,0.5)";
                  const upTxt = upFav ? "white" : "rgb(134, 239, 172)";
                  const dnFill = !upFav ? "rgba(239,68,68,0.85)" : "rgba(0,0,0,0.8)";
                  const dnStroke = !upFav ? "rgba(239,68,68,0.9)" : "rgba(148,163,184,0.5)";
                  const dnTxt = !upFav ? "white" : "rgb(252, 165, 165)";
                  return (
                    <g style={{ pointerEvents: "none" }}>
                      <title>{`Our odds · UP ${upStr} · DOWN ${dnStr}`}</title>
                      <rect data-testid="pill-up" x={oX} y={upY} width={oPW} height={oPH} rx={3}
                        fill={upFill} stroke={upStroke} strokeWidth={1} />
                      <text x={oX + 5} y={upY + oPH - 3.5}
                        fill={upTxt} fontSize={10} fontFamily="monospace" fontWeight={700}>UP</text>
                      <text x={oX + oPW - 5} y={upY + oPH - 3.5} textAnchor="end"
                        fill={upTxt} fontSize={10} fontFamily="monospace" fontWeight={700}
                        className="tabular-nums">{upStr}</text>
                      <rect data-testid="pill-down" x={oX} y={dnY} width={oPW} height={oPH} rx={3}
                        fill={dnFill} stroke={dnStroke} strokeWidth={1} />
                      <text x={oX + 5} y={dnY + oPH - 3.5}
                        fill={dnTxt} fontSize={10} fontFamily="monospace" fontWeight={700}>DN</text>
                      <text x={oX + oPW - 5} y={dnY + oPH - 3.5} textAnchor="end"
                        fill={dnTxt} fontSize={10} fontFamily="monospace" fontWeight={700}
                        className="tabular-nums">{dnStr}</text>

                      {/* time-decay bar between UP and DN pills — fills L→R as T→0 */}
                      {(() => {
                        const barY = upY + oPH + 1;
                        const barH = Math.max(1, dnY - barY - 1);
                        const decay = timeDecayFrac;
                        const fillW = Math.max(0, Math.min(oPW - 2, (oPW - 2) * decay));
                        return (
                          <g>
                            <rect x={oX + 1} y={barY} width={oPW - 2} height={barH}
                              fill="rgba(255,255,255,0.08)" />
                            <rect x={oX + 1} y={barY} width={fillW} height={barH}
                              fill="rgba(250,204,21,0.85)" />
                            {/* MID pivot marker: shows sign & strength of the tilt */}
                            {(() => {
                              const piv = midPivotTiltPct;
                              if (Math.abs(piv) < 0.0005) return null;
                              const mag = Math.min(1, Math.abs(piv) / 0.04); // vs ±4¢ cap
                              const half = (oPW - 2) / 2;
                              const cx0 = oX + 1 + half;
                              const w = Math.max(2, half * mag);
                              const x = piv >= 0 ? cx0 : cx0 - w;
                              const fill = piv >= 0 ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)";
                              return <rect x={x} y={barY} width={w} height={barH} fill={fill} />;
                            })()}
                          </g>
                        );
                      })()}
                    </g>
                  );
                })()}



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
    </div></>
  );
}
