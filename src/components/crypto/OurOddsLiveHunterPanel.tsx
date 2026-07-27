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
const TRIGGER_PROB = 2 / 3;          // American −200 ≡ 66.67%
const MAX_ASK_CENTS = 95;            // skip if Kalshi ask is already pinned
const MIN_SECS_TO_CLOSE = 15;
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

    let side: "YES" | "NO" | null = null;
    let prob = 0;
    if (pUp >= TRIGGER_PROB && pUp >= pDown) { side = "YES"; prob = pUp; }
    else if (pDown >= TRIGGER_PROB) { side = "NO"; prob = pDown; }
    if (!side) {
      const best = Math.max(pUp, pDown);
      setLastSkip(`best ${Math.round(best * 100)}¢ < ${(TRIGGER_PROB * 100).toFixed(0)}¢`);
      return;
    }

    // Kalshi ask cents for the chosen side. YES side pays yesAsk;
    // NO side pays (1 - yesBid) (since buying NO fills against yes bid).
    const kalshiAskCents = side === "YES"
      ? Math.max(1, Math.min(99, Math.round(yesAsk * 100)))
      : Math.max(1, Math.min(99, Math.round((1 - yesBid) * 100)));

    if (kalshiAskCents > MAX_ASK_CENTS) {
      setLastSkip(`kalshi ${side} ask ${kalshiAskCents}¢ > cap ${MAX_ASK_CENTS}¢`);
      return;
    }

    const key = `${ticker}|${side}`;
    if (firedKeysRef.current.has(key)) return;

    const closeIso = new Date(Date.now() + secondsToClose * 1000).toISOString();
    firedKeysRef.current.add(key);
    setFiring(true);
    const label = `${ticker} ${side === "YES" ? "UP" : "DOWN"} @ ${kalshiAskCents}¢`;

    (async () => {
      try {
        const r = await fireFn({
          data: {
            ticker,
            side,
            ourProb: prob,
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
            REAL MONEY · buys at −200 · auto-sells at +40% (entry × 1.4) · ≤{MAX_ASK_CENTS}¢ · 1 shot/side · 3-min warmup
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono tabular-nums">
            <span className={pUp != null && pUp >= TRIGGER_PROB ? "text-emerald-300" : "text-muted-foreground"}>
              UP {upAmer != null ? upAmer : (pUp != null ? `${Math.round(pUp * 100)}¢` : "—")}
            </span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span className={pDown != null && pDown >= TRIGGER_PROB ? "text-red-300" : "text-muted-foreground"}>
              DN {downAmer != null ? downAmer : (pDown != null ? `${Math.round(pDown * 100)}¢` : "—")}
            </span>
            {yesAsk != null && (
              <span className="ml-2 text-muted-foreground">
                · K ask YES {Math.round(yesAsk * 100)}¢ / NO {yesBid != null ? Math.round((1 - yesBid) * 100) : "—"}¢
              </span>
            )}
          </span>
          <div className="flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
            {firing && <Loader2 className="h-3 w-3 animate-spin" />}
            {lastFired && <span className="text-amber-200">last: {lastFired}</span>}
            {!lastFired && lastSkip && <span className="opacity-60">wait: {lastSkip}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
