import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getBtcMarkets } from "@/lib/cryptoBtc.functions";

// Kalshi-style live BTC 15-min odds panel. Read-only. No bet placement.
// Data source: getBtcMarkets (public Kalshi + BRTI spot, cached ~8s server-side).

function toAmerican(prob: number): string {
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return "—";
  const n = prob >= 0.5 ? Math.round(-100 * prob / (1 - prob)) : Math.round(100 * (1 - prob) / prob);
  return n > 0 ? `+${n}` : String(n);
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const fmtEtTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  }).toLowerCase().replace(" ", "") + " ET";
};

export function KalshiOddsWidget() {
  const marketsFn = useServerFn(getBtcMarkets);
  const q = useQuery({
    queryKey: ["kalshiOddsWidget"],
    queryFn: () => marketsFn(),
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 1_000,
  });

  // Pick the frontmost 15-min market: soonest closeTime in the future.
  const market = useMemo(() => {
    const list = q.data?.markets ?? [];
    const now = Date.now();
    const future = list
      .filter(m => m.closeTime && new Date(m.closeTime).getTime() > now)
      .sort((a, b) => new Date(a.closeTime!).getTime() - new Date(b.closeTime!).getTime());
    return future[0] ?? list[0] ?? null;
  }, [q.data]);

  if (q.isLoading && !market) {
    return (
      <div className="border border-border rounded-lg bg-card p-4 text-sm text-muted-foreground">
        Loading live Kalshi odds…
      </div>
    );
  }
  if (!market) {
    return (
      <div className="border border-border rounded-lg bg-card p-4 text-sm text-muted-foreground">
        No active BTC 15-min market.
      </div>
    );
  }

  const spot = q.data?.spot ?? market.spot;
  const strike = market.strike;
  const delta = spot - strike;
  const deltaPct = strike ? (delta / strike) * 100 : 0;
  const winning: "UP" | "DOWN" = spot >= strike ? "UP" : "DOWN";

  const upOdds = toAmerican(market.yesAsk);
  const downOdds = toAmerican(market.noAsk);

  // Countdown to close
  const secsToClose = market.secondsToClose;
  const mm = Math.max(0, Math.floor(secsToClose / 60));
  const ss = Math.max(0, secsToClose % 60);
  const closeStr = `${mm}:${String(ss).padStart(2, "0")}`;

  return (
    <div className="border border-border rounded-2xl bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-amber-500 flex items-center justify-center text-white font-bold text-sm">₿</div>
          <div>
            <div className="text-base font-semibold">BTC Up or Down · 15 minutes</div>
            <div className="text-[11px] text-muted-foreground font-mono">{market.ticker}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Closes in</div>
          <div className="font-mono tabular-nums text-sm font-semibold">{closeStr}</div>
        </div>
      </div>

      {/* Odds pills — Kalshi-style UP / DOWN */}
      <div className="flex items-stretch gap-0 rounded-full overflow-hidden border border-border w-full max-w-md">
        <div className={`flex-1 px-4 py-2.5 text-center font-bold tracking-wide text-sm ${
          winning === "UP" ? "bg-emerald-500/25 text-emerald-300" : "bg-muted/40 text-muted-foreground"
        }`}>
          UP {upOdds}
        </div>
        <div className={`flex-1 px-4 py-2.5 text-center font-bold tracking-wide text-sm ${
          winning === "DOWN" ? "bg-red-500/25 text-red-300" : "bg-muted/40 text-muted-foreground"
        }`}>
          DOWN {downOdds}
        </div>
      </div>

      {/* To Beat + Now */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">To Beat</div>
          <div className="text-2xl font-bold tabular-nums">{fmtUsd(strike)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{fmtEtTime(market.openTime)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Now</div>
          <div className="text-2xl font-bold tabular-nums">{fmtUsd(spot)}</div>
          <div className={`text-[11px] mt-0.5 tabular-nums font-semibold ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {delta >= 0 ? "+" : ""}{fmtUsd(delta)} ({delta >= 0 ? "+" : ""}{deltaPct.toFixed(3)}%)
          </div>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground flex items-center justify-between border-t border-border/60 pt-2">
        <span>Live from Kalshi · updates every 2s</span>
        <span>Read-only · use panels below to fire paper bets</span>
      </div>
    </div>
  );
}
