// Volume Flow — BTC spot taker imbalance (Binance) vs Kalshi contract-side flow.
// Read-only panel. Answers "which side is money actually taking?" on both books.

import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { fetchPolymarketBtcVolume } from "@/lib/polymarketVolume.functions";


function pct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function Bar({ left, right, leftLabel, rightLabel }: {
  left: number; right: number; leftLabel: string; rightLabel: string;
}) {
  const total = left + right;
  const lp = total > 0 ? (left / total) * 100 : 50;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{leftLabel} {left.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span>{rightLabel} {right.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-emerald-500" style={{ width: `${lp}%` }} />
        <div className="bg-rose-500" style={{ width: `${100 - lp}%` }} />
      </div>
    </div>
  );
}

export function VolumeFlowPanel() {
  const spotVolFn = useServerFn(getBtcSpotVolume);
  const kalshiFn = useServerFn(getKalshiImpliedSpot);
  const polyVolFn = useServerFn(fetchPolymarketBtcVolume);

  const { data: sv } = useQuery({
    queryKey: ["btc-spot-volume-panel"],
    queryFn: () => spotVolFn(),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
  const { data: k } = useQuery({
    queryKey: ["kalshi-implied-spot-volpanel"],
    queryFn: () => kalshiFn(),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });
  const { data: pv } = useQuery({
    queryKey: ["poly-volume-panel"],
    queryFn: () => polyVolFn(),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });

  const spotImb = sv?.window?.imbalance ?? null;
  const yesV = k?.yesVol60s ?? 0;
  const noV = k?.noVol60s ?? 0;
  const kTotal = yesV + noV;
  const kImb = kTotal > 0 ? (yesV - noV) / kTotal : null;
  const pImb60 = pv?.imbalance60s ?? null;
  const pSide = pImb60 == null ? null : pImb60 > 0.05 ? "UP" : pImb60 < -0.05 ? "DOWN" : "FLAT";


  const spotSide = spotImb == null ? null : spotImb > 0.02 ? "UP" : spotImb < -0.02 ? "DOWN" : "FLAT";
  const kSide = kImb == null ? null : kImb > 0.05 ? "UP" : kImb < -0.05 ? "DOWN" : "FLAT";
  const agree = spotSide && kSide && spotSide === kSide && spotSide !== "FLAT";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Volume Flow — Spot vs Kalshi</span>
          {agree ? (
            <Badge variant="default">Both {spotSide}</Badge>
          ) : spotSide && kSide ? (
            <Badge variant="secondary">Split · spot {spotSide} / kalshi {kSide}</Badge>
          ) : (
            <Badge variant="outline">Loading</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">BTC spot taker flow · this 15m window</span>
            <span className="text-muted-foreground">imbalance {pct(spotImb)}</span>
          </div>
          <Bar
            left={sv?.window?.buy ?? 0}
            right={sv?.window?.sell ?? 0}
            leftLabel="Buy BTC"
            rightLabel="Sell BTC"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Last 1m imbalance {pct(sv?.m1?.imbalance)}</span>
            <span>Last 15m {pct(sv?.m15?.imbalance)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Kalshi contract flow · last 60s</span>
            <span className="text-muted-foreground">imbalance {pct(kImb)}</span>
          </div>
          <Bar left={yesV} right={noV} leftLabel="YES takers" rightLabel="NO takers" />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Window volume {k?.volume?.toLocaleString() ?? "—"}</span>
            <span>Open interest {k?.openInterest?.toLocaleString() ?? "—"}</span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Spot flow from Binance BTCUSDT taker buy/sell split; Kalshi flow from
          aggressor side of the last 60s of prints on {k?.ticker ?? "the front market"}.
          Agreement on both books is the confirmation signal; a split means one
          book is leading the other.
        </p>
      </CardContent>
    </Card>
  );
}
