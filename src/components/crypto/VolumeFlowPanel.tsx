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
    // Shared key with the trendline panel/recorder: one Kalshi poll feeds all
    // consumers instead of three parallel paginated pulls (429s blanked flow).
    queryKey: ["kalshi-implied-spot"],
    queryFn: () => kalshiFn(),
    refetchInterval: 5_000,
    staleTime: 800,
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Polymarket flow · last 60s</span>
            <span className="text-muted-foreground">
              imbalance {pct(pImb60)}{pSide ? ` · ${pSide}` : ""}
            </span>
          </div>
          <Bar
            left={pv?.s60?.upShares ?? 0}
            right={pv?.s60?.downShares ?? 0}
            leftLabel="Up takers"
            rightLabel="Down takers"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="font-medium">Polymarket flow · last 15m</span>
            <span className="text-muted-foreground">imbalance {pct(pv?.imbalance15m)}</span>
          </div>
          <Bar
            left={pv?.w15?.upShares ?? 0}
            right={pv?.w15?.downShares ?? 0}
            leftLabel="Up takers"
            rightLabel="Down takers"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              Avg cost 15m · Up {pv?.avgCostUp != null ? `${(pv.avgCostUp * 100).toFixed(1)}¢` : "—"}
              {" / "}
              Down {pv?.avgCostDown != null ? `${(pv.avgCostDown * 100).toFixed(1)}¢` : "—"}
            </span>
            <span>{pv?.w15?.trades ?? 0} prints</span>
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              Notional 15m · Up ${Math.round(pv?.w15?.upNotional ?? 0).toLocaleString()} / Down $
              {Math.round(pv?.w15?.downNotional ?? 0).toLocaleString()}
            </span>
            <span>Current 5m window imbalance {pct(pv?.imbalance)}</span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Spot flow from Binance BTCUSDT taker buy/sell split; Kalshi flow from
          aggressor side of the last 60s of prints on {k?.ticker ?? "the front market"};
          Polymarket flow from taker prints on its 5-minute BTC Up/Down books
          (15m = current plus two prior windows). Agreement across books is the
          confirmation signal; a split means one book is leading the other.
        </p>

      </CardContent>
    </Card>
  );
}
