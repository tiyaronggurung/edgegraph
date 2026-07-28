// Our-Odds LIVE Hunter — REAL MONEY (mirrors OurOddsAutoBetPanel but fires on Kalshi).
// Fires a REAL $10 Kalshi IOC buy at the current Kalshi ask when OUR own
// ask-side probability (from useOurQuote) hits ≥66.7% (American −200 or better).
// One shot per (ticker, side). Default OFF. Full server-side gate re-check
// in fireOurOddsLiveBet — this panel is only the trigger loop.

import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { getCompositeSpot } from "@/lib/compositeSpot.functions";
import { evalTrendlineShadow } from "@/lib/trendlineShadow.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useOurQuote } from "@/hooks/useOurQuote";
import { fireOurOddsLiveBet, autoTakeProfitOurOddsLive } from "@/lib/ourOddsLiveHunter.functions";

const LS_ENABLED = "crypto.ourOddsLiveHunter";
const STAKE_USD = 10;
const MIN_EDGE_CENTS = 3;            // our_mid − kalshi_mid ≥ 3¢ on picked side
const MIN_SIDE_PROB = 0.55;          // never chase below coin-flip
const REQUIRED_CONSECUTIVE_TICKS = 2;
const MAX_ASK_CENTS = 85;            // matches server; tighter than legacy −200 mode
const MIN_SECS_TO_CLOSE = 20;
const WINDOW_LEN_SECS = 900;
const WARMUP_SECS = 180;
const MAX_SECS_TO_CLOSE = WINDOW_LEN_SECS - WARMUP_SECS;

export function OurOddsLiveHunterPanel() {
  const kalshiFn = useServerFn(getKalshiImpliedSpot);
  const compositeFn = useServerFn(getCompositeSpot);
  const evalFn = useServerFn(evalTrendlineShadow);
  const fireFn = useServerFn(fireOurOddsLiveBet);
  const autoTpFn = useServerFn(autoTakeProfitOurOddsLive);
  const qc = useQueryClient();

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LS_ENABLED) === "on";
  });
  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<string | null>(null);
  const [lastSkip, setLastSkip] = useState<string | null>(null);
  const [lastTp, setLastTp] = useState<string | null>(null);
  const firedKeysRef = useRef<Set<string>>(new Set());
  // Consecutive-tick counter per (ticker|side): how many ticks in a row we've
  // seen (our_prob − kalshi_mid) ≥ MIN_EDGE_CENTS with prob ≥ MIN_SIDE_PROB.
  const edgeStreakRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_ENABLED, enabled ? "on" : "off");
  }, [enabled]);

  const toggleOn = () => {
    setEnabled(true);
    toast.success(`Our-Odds LIVE Hunter ON · REAL $${STAKE_USD} · fires at −200 or better`);
  };
  const toggleOff = () => {
    setEnabled(false);
    toast.info("Our-Odds LIVE Hunter OFF");
  };

  const live = useLiveCompositeSpot();
  const { data: kalshi } = useQuery({
    queryKey: ["ourOddsLive:kalshi"],
    queryFn: () => kalshiFn(),
    refetchInterval: 2_000,
    staleTime: 1_500,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const { data: composite } = useQuery({
    queryKey: ["ourOddsLive:composite"],
    queryFn: () => compositeFn(),
    refetchInterval: 1_000,
    staleTime: 800,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const { data: shadow } = useQuery({
    queryKey: ["ourOddsLive:trendline"],
    queryFn: () => evalFn(),
    refetchInterval: 30_000,
    staleTime: 25_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const spot = live.spot ?? composite?.spot ?? shadow?.spot ?? kalshi?.impliedSpot ?? null;
  const strike = kalshi?.strike ?? null;
  const secondsToClose = kalshi?.secondsToClose ?? null;
  const ticker = kalshi?.ticker ?? null;
  const yesAsk = kalshi?.yesAsk ?? null;   // 0..1 dollars
  const yesBid = kalshi?.yesBid ?? null;

  const closes1m = useMemo<number[]>(
    () => (shadow?.candles ?? []).map((c: any) => c.c),
    [shadow?.candles],
  );
  const midPriceNow = useMemo<number | null>(() => {
    const u = shadow?.upperAtNow, l = shadow?.lowerAtNow;
    return (u != null && l != null && u > l) ? (u + l) / 2 : null;
  }, [shadow?.upperAtNow, shadow?.lowerAtNow]);

  const quote = useOurQuote({
    spot,
    strike,
    secondsToClose,
    closes1m,
    midPrice: midPriceNow,
  });

  const pUp = quote?.pUpAsk ?? null;
  const pDown = quote?.pDownAsk ?? null;
  const upAmer = pUp != null && pUp > 0.5 ? -Math.round((100 * pUp) / (1 - pUp)) : null;
  const downAmer = pDown != null && pDown > 0.5 ? -Math.round((100 * pDown) / (1 - pDown)) : null;

  useEffect(() => {
    if (!enabled || firing) return;
    if (!ticker || !strike || secondsToClose == null) return;
    if (secondsToClose < MIN_SECS_TO_CLOSE) return;
    if (secondsToClose > MAX_SECS_TO_CLOSE) {
      const wait = secondsToClose - MAX_SECS_TO_CLOSE;
      setLastSkip(`warmup — ${wait}s until window open ${WARMUP_SECS}s`);
      return;
    }
    if (!quote || pUp == null || pDown == null) return;
    if (yesAsk == null || yesBid == null) return;

    // Kalshi mid probabilities per side (mid of bid/ask on that side).
    // YES mid prob = (yesBid + yesAsk) / 2. NO mid prob = 1 − YES mid.
    const kalshiYesMidProb = (yesBid + yesAsk) / 2;
    const kalshiNoMidProb = 1 - kalshiYesMidProb;

    // Pick the side with the biggest edge (our_prob − kalshi_mid_prob),
    // provided ourProb ≥ MIN_SIDE_PROB (never bet the losing side).
    const upEdge = pUp - kalshiYesMidProb;
    const dnEdge = pDown - kalshiNoMidProb;
    let side: "YES" | "NO" | null = null;
    let prob = 0;
    let kalshiMidProb = 0;
    let edgeCents = 0;
    if (upEdge >= dnEdge && pUp >= MIN_SIDE_PROB) {
      side = "YES"; prob = pUp; kalshiMidProb = kalshiYesMidProb;
      edgeCents = Math.round(upEdge * 100);
    } else if (pDown >= MIN_SIDE_PROB) {
      side = "NO"; prob = pDown; kalshiMidProb = kalshiNoMidProb;
      edgeCents = Math.round(dnEdge * 100);
    }
    if (!side) {
      setLastSkip(`no side ≥ ${(MIN_SIDE_PROB * 100).toFixed(0)}¢ (UP ${Math.round(pUp * 100)} / DN ${Math.round(pDown * 100)})`);
      return;
    }
    if (edgeCents < MIN_EDGE_CENTS) {
      // Reset any streak on the losing candidate — edge must be sustained.
      edgeStreakRef.current.clear();
      setLastSkip(`edge ${edgeCents}¢ < ${MIN_EDGE_CENTS}¢ (${side} ours ${Math.round(prob * 100)} vs K ${Math.round(kalshiMidProb * 100)})`);
      return;
    }

    // Kalshi ask cents for the chosen side. YES pays yesAsk; NO pays (1 − yesBid).
    const kalshiAskCents = side === "YES"
      ? Math.max(1, Math.min(99, Math.round(yesAsk * 100)))
      : Math.max(1, Math.min(99, Math.round((1 - yesBid) * 100)));

    if (kalshiAskCents > MAX_ASK_CENTS) {
      edgeStreakRef.current.clear();
      setLastSkip(`kalshi ${side} ask ${kalshiAskCents}¢ > cap ${MAX_ASK_CENTS}¢`);
      return;
    }

    // Consecutive-tick gate: same side must sustain the edge for N ticks.
    const streakKey = `${ticker}|${side}`;
    // Reset any streak on the *opposite* side.
    const opposite = side === "YES" ? `${ticker}|NO` : `${ticker}|YES`;
    edgeStreakRef.current.delete(opposite);
    const nextCount = (edgeStreakRef.current.get(streakKey) ?? 0) + 1;
    edgeStreakRef.current.set(streakKey, nextCount);
    if (nextCount < REQUIRED_CONSECUTIVE_TICKS) {
      setLastSkip(`${side} edge ${edgeCents}¢ tick ${nextCount}/${REQUIRED_CONSECUTIVE_TICKS}`);
      return;
    }

    const key = `${ticker}|${side}`;
    if (firedKeysRef.current.has(key)) return;

    const closeIso = new Date(Date.now() + secondsToClose * 1000).toISOString();
    firedKeysRef.current.add(key);
    setFiring(true);
    const label = `${ticker} ${side === "YES" ? "UP" : "DOWN"} +${edgeCents}¢ @ ${kalshiAskCents}¢`;

    (async () => {
      try {
        const r = await fireFn({
          data: {
            ticker,
            side,
            ourProb: prob,
            kalshiMidProb,
            kalshiAskCents,
            closeTime: closeIso,
            spot,
            strike,
            secondsToClose,
            upCents: quote.upCents,
            downCents: quote.downCents,
            midPrice: midPriceNow,
          },
        });
        if (r?.passed) {
          setLastFired(`${label} · fill ${r.fillCount}c @ ${r.fillPriceCents}¢`);
          toast.success(`LIVE FIRE: ${label}`);
          qc.invalidateQueries({ queryKey: ["cryptoTrades"] });
          qc.invalidateQueries({ queryKey: ["bigFlipSignals"] });
        } else {
          firedKeysRef.current.delete(key);
          setLastSkip(r?.rejectReason ?? "unknown reject");
          toast.warning(`Skipped: ${r?.rejectReason ?? "unknown"}`);
        }
      } catch (e: any) {
        firedKeysRef.current.delete(key);
        toast.error("Our-Odds LIVE fire failed", { description: e?.message ?? String(e) });
      } finally {
        setFiring(false);
      }
    })();
  }, [enabled, firing, quote, pUp, pDown, ticker, strike, secondsToClose, midPriceNow, spot, yesAsk, yesBid, fireFn, qc]);

  const lastTickerRef = useRef<string | null>(null);
  useEffect(() => {
    if (ticker && lastTickerRef.current !== ticker) {
      lastTickerRef.current = ticker;
      firedKeysRef.current.clear();
    }
  }, [ticker]);

  // Auto-TP watcher: while enabled, poll every 4s and IOC-sell any open
  // our_odds_live_hunter position when Kalshi mark ≥ entry × 1.4 (+40%).
  const tpBusyRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || tpBusyRef.current) return;
      tpBusyRef.current = true;
      try {
        const r = await autoTpFn({});
        if (r && r.fired > 0) {
          const winners = r.results.filter((x) => x.fired);
          const label = winners.map((w) => `${w.ticker} ${w.side} +$${(w.realizedPnl ?? 0).toFixed(2)} @ ${w.exitCents}¢`).join(" · ");
          setLastTp(label);
          toast.success(`Auto-TP filled: ${label}`);
          qc.invalidateQueries({ queryKey: ["cryptoTrades"] });
        }
      } catch {
        /* swallow — retry next tick */
      } finally {
        tpBusyRef.current = false;
      }
    };
    tick();
    const id = window.setInterval(tick, 4_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled, autoTpFn, qc]);


  return (
    <div className="border border-amber-500/40 rounded-lg bg-amber-500/5 mt-2">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={enabled ? toggleOff : toggleOn}
            className={`text-xs font-semibold px-3 py-1.5 rounded border flex items-center gap-1.5 ${enabled ? "border-amber-500/70 bg-amber-500/25 text-amber-200" : "border-border bg-muted/30 hover:bg-muted/50"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-amber-400 animate-pulse" : "bg-muted-foreground"}`} />
            {enabled ? `Our-Odds LIVE Hunter ON · REAL $${STAKE_USD}` : `Our-Odds LIVE Hunter OFF · REAL $${STAKE_USD}`}
          </button>
          <span className="text-[11px] text-amber-200/70">
            REAL MONEY · fires on (our_mid − K_mid) ≥ {MIN_EDGE_CENTS}¢ held {REQUIRED_CONSECUTIVE_TICKS} ticks · ≤{MAX_ASK_CENTS}¢ · TP +40% · 1 shot/side · 3-min warmup
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono tabular-nums">
            <span className={pUp != null && pUp >= MIN_SIDE_PROB ? "text-emerald-300" : "text-muted-foreground"}>
              UP {upAmer != null ? upAmer : (pUp != null ? `${Math.round(pUp * 100)}¢` : "—")}
            </span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span className={pDown != null && pDown >= MIN_SIDE_PROB ? "text-red-300" : "text-muted-foreground"}>
              DN {downAmer != null ? downAmer : (pDown != null ? `${Math.round(pDown * 100)}¢` : "—")}
            </span>
            {yesAsk != null && yesBid != null && (
              <span className="ml-2 text-muted-foreground">
                · K mid YES {Math.round(((yesBid + yesAsk) / 2) * 100)}¢ / NO {Math.round((1 - (yesBid + yesAsk) / 2) * 100)}¢
              </span>
            )}
          </span>
          <div className="flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
            {firing && <Loader2 className="h-3 w-3 animate-spin" />}
            {lastFired && <span className="text-amber-200">buy: {lastFired}</span>}
            {lastTp && <span className="text-emerald-300">TP: {lastTp}</span>}
            {!lastFired && !lastTp && lastSkip && <span className="opacity-60">wait: {lastSkip}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
