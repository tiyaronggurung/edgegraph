// Agreement table — do all four read-only signals point the same way?
//   1. Our odds on the live strike (same engine as the price card)
//   2. BTC taker volume in vs out (last 3 closed minutes)
//   3. Model pick
//   4. Study pick (T7 lock, falls back to the shadow lock)
// Display only. Nothing here is wired to any bet path.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBtcSpotVolume } from "@/lib/btcSpotVolume.functions";
import { getBtcFlowLeanHistory } from "@/lib/btcFlowLeanHistory.functions";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";
import { getBtcConsensusView } from "@/lib/btcConsensusView.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useStrikeOdds } from "@/hooks/useStrikeOdds";

type Dir = "UP" | "DOWN" | null;

function toneFor(d: Dir): string {
  if (d === "UP") return "text-emerald-400";
  if (d === "DOWN") return "text-rose-400";
  return "text-muted-foreground";
}

function Row({ label, dir, detail }: { label: string; dir: Dir; detail: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border/50 py-1 first:border-t-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-muted-foreground">{detail}</span>
        <span className={`font-semibold ${toneFor(dir)}`}>{dir ?? "—"}</span>
      </span>
    </div>
  );
}

export function BtcAgreementPanel() {
  const live = useLiveCompositeSpot();

  // Local 1s clock for the window countdown (never waits on a feed).
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const winStart = Math.floor(now / 900_000) * 900_000;
  const secondsToClose = Math.max(0, Math.round((winStart + 900_000 - now) / 1000));

  const strikeFn = useServerFn(getKalshiImpliedSpot);
  const { data: kalshi } = useQuery({
    queryKey: ["btc-agreement-strike", winStart],
    queryFn: () => strikeFn(),
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });

  const volFn = useServerFn(getBtcSpotVolume);
  const { data: win } = useQuery({
    queryKey: ["btc-agreement-volume"],
    queryFn: () => volFn(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });

  const histFn = useServerFn(getBtcFlowLeanHistory);
  const { data: hist } = useQuery({
    queryKey: ["btc-flow-lean-history"],
    queryFn: () => histFn(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });

  const consensusFn = useServerFn(getBtcConsensusView);
  const { data: cons } = useQuery({
    queryKey: ["btc-agreement-consensus"],
    queryFn: () => consensusFn(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  });

  const strike = kalshi?.strike ?? cons?.strike ?? null;
  const spot = live.targetSpot ?? live.spot ?? cons?.spot ?? null;
  const currentRow = hist?.rows?.find((r) => r.result == null) ?? hist?.rows?.[0] ?? null;
  const imbM3 = win?.m3?.imbalance ?? null;

  const odds = useStrikeOdds(spot, strike, secondsToClose, {
    m1: hist?.live?.m1 ?? null,
    m15: hist?.live?.m15 ?? null,
    avgBuyPrice: currentRow?.avgBuyPrice ?? null,
    avgSellPrice: currentRow?.avgSellPrice ?? null,
    flowImbalance: imbM3,
    stack: hist?.live?.stack ?? null,
  });

  // 1. Our odds
  const oddsDir: Dir = odds.pUp == null ? null : odds.pUp >= 0.5 ? "UP" : "DOWN";
  const oddsDetail = odds.pUp == null ? "—" : `${(odds.pUp * 100).toFixed(1)}%`;

  // 2. Volume in vs out — this 15m window's running taker totals (dead zone ±5%)
  const imbWin = currentRow?.imbWindow ?? null;
  const volDir: Dir = imbWin == null ? null : imbWin > 0.05 ? "UP" : imbWin < -0.05 ? "DOWN" : null;
  const buy = currentRow?.buyBtc ?? null;
  const sell = currentRow?.sellBtc ?? null;
  const volDetail =
    buy == null || sell == null
      ? "—"
      : `${buy.toFixed(1)}↑ / ${sell.toFixed(1)}↓ · ${(buy + sell).toFixed(1)} BTC${imbWin != null ? ` · ${(imbWin * 100).toFixed(0)}%` : ""}`;

  // 3 & 4. Model + study picks
  const sideOf = (s: "YES" | "NO" | null | undefined): Dir =>
    s === "YES" ? "UP" : s === "NO" ? "DOWN" : null;
  const modelDir = sideOf(cons?.modelSide);
  const studyDir = sideOf(cons?.studySide);
  const pct = (v: number | null | undefined) =>
    v == null ? "—" : `${(v <= 1 ? v * 100 : v).toFixed(0)}%`;

  const dirs: Dir[] = [oddsDir, volDir, modelDir, studyDir];
  const known = dirs.filter((d): d is "UP" | "DOWN" => d != null);
  const ups = known.filter((d) => d === "UP").length;
  const downs = known.length - ups;
  const allFour = known.length === 4 && (ups === 4 || downs === 4);
  const agreedSide: Dir = ups > downs ? "UP" : downs > ups ? "DOWN" : null;

  const headline = allFour
    ? `ALL 4 AGREE · ${agreedSide}`
    : known.length === 0
      ? "NO DATA"
      : `${Math.max(ups, downs)}/4 ${agreedSide ?? "SPLIT"}`;

  return (
    <Card className={allFour ? "border-emerald-500/50" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Agreement — odds · volume · model · study</span>
          <Badge
            className={
              allFour && agreedSide === "UP"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : allFour && agreedSide === "DOWN"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : "bg-muted text-muted-foreground border border-border/60"
            }
          >
            {headline}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        <Row label="Our odds on this strike" dir={oddsDir} detail={`p(up) ${oddsDetail}`} />
        <Row label="BTC volume in vs out (3m)" dir={volDir} detail={volDetail} />
        <Row label="Model pick" dir={modelDir} detail={pct(cons?.modelConfidence)} />
        <Row
          label="Study pick"
          dir={studyDir}
          detail={studyDir == null ? "no lock yet" : pct(cons?.studyConfidence)}
        />
        <div className="flex items-center justify-between border-t border-border/50 pt-1 font-mono text-[10px] text-muted-foreground">
          <span>
            strike {strike != null ? `$${strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
            {strike != null && spot != null
              ? ` · ${spot >= strike ? "+" : "−"}$${Math.abs(spot - strike).toFixed(0)}`
              : ""}
          </span>
          <span>
            {Math.floor(secondsToClose / 60)}m{secondsToClose % 60}s left
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          all four on the same side is the strongest read · a split means the window is a coin flip ·
          display only, not wired to any bet
        </p>
      </CardContent>
    </Card>
  );
}
