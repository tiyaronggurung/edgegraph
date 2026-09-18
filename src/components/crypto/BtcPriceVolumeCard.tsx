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
  const chg = data?.change24hPct ?? null;
  const up = (chg ?? 0) >= 0;

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
          <span className="text-[10px] text-muted-foreground">
            {live.spot != null ? "live composite" : "binance last"}
          </span>
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
