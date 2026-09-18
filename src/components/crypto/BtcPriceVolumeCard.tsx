// BTC Price & Volume — live Binance BTC/USDT price, 24h change, and REAL
// BTC traded volume (BTC + USD notional). Read-only display card.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBtcPriceVolume } from "@/lib/btcPriceVolume.functions";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import {
  computeFlowLean,
  flowLeanWinRate,
  logBtcFlowLean,
} from "@/lib/btcFlowLean.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useStrikeOdds } from "@/hooks/useStrikeOdds";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";

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
  const live = useLiveCompositeSpot();
  const { data } = useQuery({
    queryKey: ["btc-price-volume"],
    queryFn: () => fn(),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
  const { data: win } = useQuery({
    queryKey: ["btc-price-volume-15m-window"],
    queryFn: () => spotVolFn(),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const price = live.spot ?? data?.price ?? null;
  // Current 15m strike (read-only) + our own fast quote off it.
  const strikeFn = useServerFn(getKalshiImpliedSpot);
  const { data: kalshi } = useQuery({
    queryKey: ["btc-card-strike"],
    queryFn: () => strikeFn(),
    refetchInterval: 5_000,
    staleTime: 2_000,
    placeholderData: keepPreviousData,
  });
  const lastStrikeRef = useRef<number | null>(null);
  if (kalshi?.ok && kalshi.strike != null) lastStrikeRef.current = kalshi.strike;
  const strike = kalshi?.strike ?? lastStrikeRef.current;
  const chg = data?.change24hPct ?? null;
  const up = (chg ?? 0) >= 0;

  // --- Flow lean (read-only) ---------------------------------------------
  // Lean uses the last 3 closed minutes (the leg that carried edge in the
  // study); window imbalance is shown as context.
  const imbM3 = win?.m3?.imbalance ?? null;
  const imbWin = win?.window?.imbalance ?? null;
  const lean = computeFlowLean(imbM3);
  const now = Date.now();
  const winStart = Math.floor(now / 900_000) * 900_000;
  const secondsToClose = Math.max(0, Math.round((winStart + 900_000 - now) / 1000));
  const winRate = flowLeanWinRate(lean, secondsToClose);

  // Our own quote off the live composite vs the strike (display only).
  const odds = useStrikeOdds(price, strike ?? null, kalshi?.secondsToClose ?? secondsToClose);
  const cents = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}¢`);

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
        volWindowBtc: win?.window?.total ?? null,
        buyWindowBtc: win?.window?.buy ?? null,
        sellWindowBtc: win?.window?.sell ?? null,
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
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            recomputed on every composite tick · display only · not wired to any bet
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
            {win?.window && (
              <span className="text-[10px] font-mono">
                <span className="text-emerald-400">{win.window.buy.toFixed(1)}↑</span>
                {" / "}
                <span className="text-rose-400">{win.window.sell.toFixed(1)}↓</span>
              </span>
            )}
          </div>
          <div className="font-mono font-semibold">
            {win?.window != null
              ? `${win.window.total.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC`
              : "—"}
          </div>
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
