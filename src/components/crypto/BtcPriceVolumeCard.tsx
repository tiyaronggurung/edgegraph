// BTC Price & Volume — live Binance BTC/USDT price, 24h change, and REAL
// BTC traded volume (BTC + USD notional). Read-only display card.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBtcPriceVolume } from "@/lib/btcPriceVolume.functions";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { getBtcMultiVenueVolume } from "@/lib/btcMultiVenueVolume.functions";
import {
  computeFlowLean,
  flowLeanWinRate,
  logBtcFlowLean,
} from "@/lib/btcFlowLean.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useStrikeOdds } from "@/hooks/useStrikeOdds";
import { getKalshiCurrentStrike } from "@/lib/kalshiCurrentStrike.functions";
import { getBtcFlowLeanHistory } from "@/lib/btcFlowLeanHistory.functions";
import { getBtcMarkets } from "@/lib/cryptoBtc.functions";

function fmtUsd(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function compact(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  return fmtUsd(x);
}

export function BtcPriceVolumeCard() {
  const fn = useServerFn(getBtcPriceVolume);
  const spotVolFn = useServerFn(getBtcSpotVolume);
  const multiVenueFn = useServerFn(getBtcMultiVenueVolume);
  const live = useLiveCompositeSpot();

  // Local 1s clock so the countdown and window rollover never wait on a feed.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const winStart = Math.floor(now / 900_000) * 900_000;
  const secondsToClose = Math.max(0, Math.round((winStart + 900_000 - now) / 1000));

  const { data } = useQuery({
    queryKey: ["btc-price-volume"],
    queryFn: () => fn(),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (a) => Math.min(200 * 2 ** a, 1_500),
    placeholderData: keepPreviousData,
  });
  const { data: win } = useQuery({
    queryKey: ["btc-price-volume-15m-window", winStart],
    queryFn: async () => {
      const result = await spotVolFn();
      if (!result.ok || result.windowStart == null || result.window == null) {
        throw new Error(result.error ?? "BTC window volume unavailable");
      }
      return result;
    },
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (a) => Math.min(1000 * 2 ** a, 8_000),
    placeholderData: keepPreviousData,
  });

  // Context-only multi-exchange totals; separate query so it can never
  // delay price, volume or odds.
  const { data: multi } = useQuery({
    queryKey: ["btc-multi-venue-volume"],
    queryFn: () => multiVenueFn(),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: 2,
    retryDelay: (a) => Math.min(1000 * 2 ** a, 8_000),
    placeholderData: keepPreviousData,
  });

  const price = live.spot ?? data?.price ?? null;

  // Current 15m strike (read-only) + our own fast quote off it.
  // Keyed by window so a rollover forces a fresh fetch instead of reusing the
  // previous window's strike, and polled fast so a new strike lands right away.
  const strikeFn = useServerFn(getKalshiCurrentStrike);
  const marketsFn = useServerFn(getBtcMarkets);
  const qc = useQueryClient();
  const { data: kalshi } = useQuery({
    queryKey: ["btc-card-strike", winStart],
    queryFn: async () => {
      const result = await strikeFn();
      if (!result.ok || result.strike == null) {
        throw new Error(result.error ?? "BTC strike unavailable");
      }
      return result;
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (a) => Math.min(200 * 2 ** a, 1_500),
    staleTime: 0,
    gcTime: 60_000,
  });
  // The page already owns this query. Subscribing with the identical key adds
  // no extra request and gives the card a warm strike when the lightweight
  // Kalshi endpoint is temporarily rate-limited during a fresh sign-in.
  const { data: sharedMarkets } = useQuery({
    queryKey: ["btc-markets"],
    queryFn: () => marketsFn(),
    refetchInterval: 2_000,
    staleTime: 1_000,
    placeholderData: keepPreviousData,
  });
  // Drop any strike cached against an earlier window the moment we roll over.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["btc-card-strike"] });
  }, [winStart, qc]);

  // Only reuse a held strike inside the same window; never across a rollover.
  const lastStrikeRef = useRef<{ winStart: number; strike: number } | null>(null);
  if (kalshi?.ok && kalshi.strike != null) {
    lastStrikeRef.current = { winStart, strike: kalshi.strike };
  }
  const held = lastStrikeRef.current;
  const sharedStrike = sharedMarkets?.markets
    ?.filter((market) => market.secondsToClose > 0)
    .sort((a, b) => a.secondsToClose - b.secondsToClose)[0]?.strike ?? null;
  const strike =
    kalshi?.strike ?? sharedStrike ?? (held != null && held.winStart === winStart ? held.strike : null);
  const chg = data?.change24hPct ?? null;
  const up = (chg ?? 0) >= 0;

  // --- Flow lean (read-only) ---------------------------------------------
  // Lean uses the last 3 closed minutes (the leg that carried edge in the
  // study); window imbalance is shown as context.
  const imbM3 = win?.m3?.imbalance ?? null;
  // Only trust the window leg when the payload belongs to the window on screen,
  // so a kept-previous snapshot can't show last window's totals after rollover.
  const winLeg = win?.windowStart === winStart ? (win?.window ?? null) : null;
  const imbWin = winLeg?.imbalance ?? null;
  const lean = computeFlowLean(imbM3);
  const winRate = flowLeanWinRate(lean, secondsToClose);

  // Live SMA/RSI/MACD + average taker cost (shared query with the flow log).
  const histFn = useServerFn(getBtcFlowLeanHistory);
  const { data: hist } = useQuery({
    queryKey: ["btc-flow-lean-history"],
    queryFn: () => histFn(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (a) => Math.min(1000 * 2 ** a, 8_000),
    placeholderData: keepPreviousData,
  });
  const currentRow = hist?.rows?.find((r) => r.result == null) ?? hist?.rows?.[0] ?? null;

  // Our own quote off the live composite vs the strike (display only).
  // Feed the RAW weighted target (not the smoothed display value) so the odds
  // react on the tick itself — the rAF lerp is for the eye, not the math.
  const oddsSpot = live.targetSpot ?? price;
  const odds = useStrikeOdds(oddsSpot, strike ?? null, secondsToClose, {
    m1: hist?.live?.m1 ?? null,
    m15: hist?.live?.m15 ?? null,
    avgBuyPrice: currentRow?.avgBuyPrice ?? null,
    avgSellPrice: currentRow?.avgSellPrice ?? null,
    flowImbalance: imbM3,
    stack: hist?.live?.stack ?? null,
  });
  const cents = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}¢`);
  const tiltTone = (v: number | null) =>
    v == null ? "text-muted-foreground" : v > 0.1 ? "text-emerald-400" : v < -0.1 ? "text-rose-400" : "text-muted-foreground";
  const sig = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}`);
  // "now UP +$22" — which side price currently sits on, and by how much.
  const gapTxt =
    odds.distanceUsd == null || odds.side == null
      ? ""
      : ` ${odds.side === "UP" ? "+" : "−"}$${Math.abs(odds.distanceUsd).toFixed(0)}`;

  // Log one row per minute per window so the lean can be scored later.
  const logFlow = useServerFn(logBtcFlowLean);
  const loggedRef = useRef<string>("");
  useEffect(() => {
    if (!win?.ok || imbM3 == null) return;
    const bucket = `${winStart}:${Math.floor(now / 60_000)}`;
    if (loggedRef.current === bucket) return;
    loggedRef.current = bucket;
    void logFlow({
      data: {
        windowStart: new Date(winStart).toISOString(),
        secondsToClose,
        lean,
        imbM3,
        imbWindow: imbWin,
        volWindowBtc: winLeg?.total ?? null,
        buyWindowBtc: winLeg?.buy ?? null,
        sellWindowBtc: winLeg?.sell ?? null,
        spot: price,
        expectedWinRate: winRate,
      },
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win?.lastCloseTime, imbM3]);


  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>BTC Price &amp; Volume — Binance spot</span>
          {chg != null && (
            <Badge variant={up ? "default" : "destructive"}>
              24h {up ? "+" : ""}{chg.toFixed(2)}%
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-end justify-between">
          <span className={`text-2xl font-bold font-mono ${live.spot != null ? "text-foreground" : "text-muted-foreground"}`}>
            {price != null ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </span>
          {strike != null && price != null && (
            <span
              className={`mb-1 font-mono text-xs font-semibold ${
                price >= strike ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {price >= strike ? "+" : "−"}${Math.abs(price - strike).toFixed(2)}
            </span>
          )}
          <div className="text-right">
            <div className="font-mono text-sm">
              <span className="text-[10px] text-muted-foreground">strike </span>
              {strike != null ? `$${strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {live.spot != null ? "live composite" : "binance last"}
              {strike != null && price != null
                ? ` · ${price >= strike ? "+" : ""}${(price - strike).toFixed(0)}`
                : ""}
            </span>
          </div>
        </div>

        <div className="rounded border border-border/60 bg-muted/10 px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Our odds on this strike</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {odds.sigma != null ? `σ ${(odds.sigma * 100).toFixed(0)}%` : "warming up"}
              {odds.spread != null ? ` · vig ${(odds.spread * 100).toFixed(1)}¢` : ""}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
            <span>
              <span className="text-emerald-400">UP {cents(odds.upAsk)}</span>
              {" · "}
              <span className="text-rose-400">DOWN {cents(odds.downAsk)}</span>
            </span>
            <span className="text-muted-foreground">
              p(up) {odds.pUp == null ? "—" : `${(odds.pUp * 100).toFixed(1)}%`}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
            <span className="text-muted-foreground">
              SMA <span className={tiltTone(odds.parts.sma)}>{sig(odds.parts.sma)}</span>
              {" · "}RSI <span className={tiltTone(odds.parts.rsi)}>{sig(odds.parts.rsi)}</span>
              {" · "}MACD <span className={tiltTone(odds.parts.macd)}>{sig(odds.parts.macd)}</span>
              {" · "}cost <span className={tiltTone(odds.parts.cost)}>{sig(odds.parts.cost)}</span>
              {" · "}flow <span className={tiltTone(odds.parts.flow)}>{sig(odds.parts.flow)}</span>
              {" · "}brk <span className={tiltTone(odds.parts.brk)}>{sig(odds.parts.brk)}</span>
              {" · "}stk <span className={tiltTone(odds.parts.stk)}>{sig(odds.parts.stk)}</span>
            </span>
            <span className="text-muted-foreground">
              tilt <span className={tiltTone(odds.tilt)}>{sig(odds.tilt)}</span>
              {" · "}t-wt {(odds.timeWeight * 100).toFixed(0)}%
            </span>
          </div>
          {odds.stackNote != null && (
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
              SMA 10/50/200{" "}
              <span className={tiltTone(odds.parts.stk)}>{odds.stackNote}</span>
              {odds.stackFlip > 0 ? " · cross against our side" : ""}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
            <span className="text-muted-foreground">
              drift{" "}
              <span className={tiltTone(odds.driftUsdPerMin == null ? null : odds.driftUsdPerMin / 50)}>
                {odds.driftUsdPerMin == null
                  ? "—"
                  : `${odds.driftUsdPerMin >= 0 ? "+" : ""}$${odds.driftUsdPerMin.toFixed(0)}/min`}
              </span>
              {" · "}to strike{" "}
              {odds.distanceUsd == null
                ? "—"
                : `${odds.distanceUsd >= 0 ? "+" : ""}$${odds.distanceUsd.toFixed(0)}`}
            </span>
            <span className="text-muted-foreground">
              {odds.etaSeconds != null && odds.etaSeconds <= secondsToClose
                ? `cross in ~${Math.round(odds.etaSeconds)}s`
                : "no cross projected"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className={odds.flipFlag ? "text-amber-300 font-semibold" : "text-muted-foreground"}>
              {odds.flipFlag
                ? `⚠ now ${odds.side ?? "—"}${gapTxt} · crossing the strike makes it ${odds.flipSide ?? "—"} · ${odds.flipReason}`
                : `now ${odds.side ?? "—"}${gapTxt} · a cross would make it ${odds.flipSide ?? "—"} · risk ${odds.flipRisk == null ? "—" : `${(odds.flipRisk * 100).toFixed(0)}%`}`}
            </span>
            <span className="text-muted-foreground font-mono">
              base {odds.pBase == null ? "—" : `${(odds.pBase * 100).toFixed(0)}%`}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
            <span className="text-muted-foreground">
              conviction{" "}
              <span className={tiltTone(odds.conviction)}>{sig(odds.conviction)}</span>
              {" · "}cap {(odds.pCap * 100).toFixed(0)}%
            </span>
            <span className="text-muted-foreground">
              raw {odds.pRaw == null ? "—" : `${(odds.pRaw * 100).toFixed(0)}%`}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            distance alone is capped — a high price needs indicators, break structure and drift on
            the same side, with time nearly out · SMA 10/50/200 stack feeds the odds and arms flip
            warnings early, it never calls direction on its own · flip side is always the opposite
            of where price sits now, named before it happens · display only
          </div>

        </div>


        <div className="rounded border border-border/60 bg-muted/10 px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Flow lean (last 3m taker flow)</span>
            <Badge
              className={
                lean === "UP"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : lean === "DOWN"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                    : "bg-muted text-muted-foreground border border-border/60"
              }
            >
              {lean}
            </Badge>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
            <span>
              3m {imbM3 != null ? `${(imbM3 * 100).toFixed(1)}%` : "—"}
              <span className="text-muted-foreground">
                {" "}· win {imbWin != null ? `${(imbWin * 100).toFixed(1)}%` : "—"}
              </span>
            </span>
            <span className="text-muted-foreground">
              {winRate != null ? `hist ${(winRate * 100).toFixed(0)}%` : "—"} · {Math.floor(secondsToClose / 60)}m{secondsToClose % 60}s left
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            read-only · logged each minute · not wired to any bet
          </div>
        </div>

        <div className="rounded border border-border/60 bg-muted/10 px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">BTC volume this 15m window</span>
            {winLeg && (
              <span className="text-[10px] font-mono">
                <span className="text-emerald-400">in {winLeg.buy.toFixed(1)} BTC↑</span>
                {" / "}
                <span className="text-rose-400">out {winLeg.sell.toFixed(1)} BTC↓</span>
              </span>
            )}
          </div>
          <div className="font-mono font-semibold">
            {winLeg != null
              ? `${winLeg.total.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC`
              : "—"}
          </div>
          {multi?.ok && multi.windowStart === winStart && multi.coinbaseFlow && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px]">
              <span className="text-muted-foreground">Coinbase in/out</span>
              <span className="text-emerald-400">in {multi.coinbaseFlow.inBtc.toFixed(1)} BTC↑</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-rose-400">out {multi.coinbaseFlow.outBtc.toFixed(1)} BTC↓</span>
              {multi.coinbaseFlow.avgIn != null && multi.coinbaseFlow.avgOut != null && (
                <span className="text-muted-foreground">
                  avg in ${multi.coinbaseFlow.avgIn.toLocaleString(undefined, { maximumFractionDigits: 0 })} / out $
                  {multi.coinbaseFlow.avgOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              )}
              {multi.coinbaseFlow.partial && (
                <span className="text-amber-400/80">partial sample</span>
              )}
            </div>
          )}
          {winLeg && multi?.ok && multi.windowStart === winStart && multi.coinbaseFlow && (() => {
            const ci = winLeg.buy + multi.coinbaseFlow.inBtc;
            const co = winLeg.sell + multi.coinbaseFlow.outBtc;
            const ct = ci + co;
            const cImb = ct > 0 ? (ci - co) / ct : null;
            // volume-weighted composite avg in/out across venues that report one
            const inLegs: Array<[number, number]> = [];
            if (winLeg.avgBuyPrice != null && winLeg.buy > 0) inLegs.push([winLeg.buy, winLeg.avgBuyPrice]);
            if (multi.coinbaseFlow.avgIn != null && multi.coinbaseFlow.inBtc > 0)
              inLegs.push([multi.coinbaseFlow.inBtc, multi.coinbaseFlow.avgIn]);
            const outLegs: Array<[number, number]> = [];
            if (winLeg.avgSellPrice != null && winLeg.sell > 0) outLegs.push([winLeg.sell, winLeg.avgSellPrice]);
            if (multi.coinbaseFlow.avgOut != null && multi.coinbaseFlow.outBtc > 0)
              outLegs.push([multi.coinbaseFlow.outBtc, multi.coinbaseFlow.avgOut]);
            const wavg = (legs: Array<[number, number]>) => {
              const v = legs.reduce((s, [b]) => s + b, 0);
              return v > 0 ? legs.reduce((s, [b, p]) => s + b * p, 0) / v : null;
            };
            const cAvgIn = wavg(inLegs);
            const cAvgOut = wavg(outLegs);
            return (
              <div className="mt-1 rounded border border-border/60 bg-muted/20 px-1.5 py-1 font-mono text-[10px]">
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <span className="text-muted-foreground">composite in/out (Binance + Coinbase)</span>
                  {cImb != null && (
                    <span className={`font-semibold ${cImb >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {(cImb * 100).toFixed(0)}% {cImb >= 0 ? "buy-side" : "sell-side"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-emerald-400 font-semibold">in {ci.toFixed(1)} BTC↑</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-rose-400 font-semibold">out {co.toFixed(1)} BTC↓</span>
                  <span className="text-muted-foreground">
                    net {ci - co >= 0 ? "+" : "−"}{Math.abs(ci - co).toFixed(1)} BTC
                  </span>
                  {cImb != null && Math.abs(cImb) >= 0.05 && (
                    <span className={cImb >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {cImb >= 0 ? "buyers in control" : "sellers in control"}
                    </span>
                  )}
                </div>
                {(cAvgIn != null || cAvgOut != null) && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground">
                    <span>
                      composite avg in{" "}
                      <span className="text-emerald-400">
                        {cAvgIn != null ? `$${cAvgIn.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                      </span>
                    </span>
                    <span>
                      avg out{" "}
                      <span className="text-rose-400">
                        {cAvgOut != null ? `$${cAvgOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                      </span>
                    </span>
                    {price != null && cAvgIn != null && (
                      <span>
                        now vs avg in{" "}
                        <span className={price >= cAvgIn ? "text-emerald-400" : "text-rose-400"}>
                          {price >= cAvgIn ? "+" : "−"}${Math.abs(price - cAvgIn).toFixed(0)}
                        </span>
                      </span>
                    )}
                    {cAvgIn != null && cAvgOut != null && (
                      <span className={cAvgIn >= cAvgOut ? "text-emerald-400" : "text-rose-400"}>
                        {cAvgIn >= cAvgOut ? "in-flow paying up" : "out-flow dumping"}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {winLeg != null && (winLeg.avgBuyPrice != null || winLeg.avgSellPrice != null) && (
            <div className="mt-0.5 space-y-0.5 font-mono text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  avg in{" "}
                  <span className="text-emerald-400">
                    {winLeg.avgBuyPrice != null ? `$${winLeg.avgBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                  </span>
                  {" · "}avg out{" "}
                  <span className="text-rose-400">
                    {winLeg.avgSellPrice != null ? `$${winLeg.avgSellPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                  </span>
                </span>
                {winLeg.avgBuyPrice != null && winLeg.avgSellPrice != null && (
                  <span className={winLeg.avgBuyPrice >= winLeg.avgSellPrice ? "text-emerald-400" : "text-rose-400"}>
                    {winLeg.avgBuyPrice >= winLeg.avgSellPrice ? "in-flow paying up" : "out-flow dumping"}
                  </span>
                )}
              </div>
              {price != null && winLeg.avgBuyPrice != null && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>
                    now vs avg in{" "}
                    <span className={price >= winLeg.avgBuyPrice ? "text-emerald-400" : "text-rose-400"}>
                      {price >= winLeg.avgBuyPrice ? "+" : "−"}${Math.abs(price - winLeg.avgBuyPrice).toFixed(0)}
                    </span>
                  </span>
                  <span>
                    {price >= winLeg.avgBuyPrice
                      ? "buyers in profit — in-flow pushed price"
                      : "buyers underwater — in-flow not pushing"}
                  </span>
                </div>
              )}
            </div>
          )}
          {multi?.ok && multi.windowStart === winStart && (
            <div className="mt-1 border-t border-border/40 pt-1 font-mono text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">all markets this window</span>
                <span className="font-semibold">
                  {multi.totalBtc.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-muted-foreground">
                {multi.venues.map((v) => (
                  <span key={v.venue}>
                    {v.venue}{" "}
                    <span className={v.btc == null ? "text-muted-foreground/60" : "text-foreground"}>
                      {v.btc != null ? v.btc.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
                    </span>
                  </span>
                ))}
                {multi.binanceShare != null && (
                  <span>· Binance {(multi.binanceShare * 100).toFixed(0)}% of total</span>
                )}
              </div>
              <div className="mt-0.5 text-muted-foreground/70">
                Kraken + Bitstamp stay totals-only (no free taker-side feed)
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-border/60 bg-muted/10 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">24h volume (BTC)</div>
            <div className="font-mono font-semibold">
              {data?.volume24hBtc != null
                ? `${data.volume24hBtc.toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC`
                : "—"}
            </div>
          </div>
          <div className="rounded border border-border/60 bg-muted/10 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">24h volume (USD)</div>
            <div className="font-mono font-semibold">{compact(data?.volume24hUsd)}</div>
          </div>
        </div>

        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>24h high {fmtUsd(data?.high24h)}</span>
          <span>24h low {fmtUsd(data?.low24h)}</span>
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>24h trades {data?.trades24h != null ? data.trades24h.toLocaleString() : "—"}</span>
          <span>source: Binance BTCUSDT</span>
        </div>
        {data?.error && (
          <p className="text-[10px] text-red-400">feed error: {data.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
