import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getBtcMarkets } from "@/lib/cryptoBtc.functions";
import { recordPaperFire } from "@/lib/paperTrading.functions";

// Kalshi-style live BTC 15-min odds panel. Optionally supports one-tap paper
// bet placement via UP/DOWN buttons (enableBetting=true). Data source:
// getBtcMarkets (public Kalshi + BRTI spot, cached ~8s server-side).

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

export function KalshiOddsWidget({ enableBetting = false }: { enableBetting?: boolean }) {
  const marketsFn = useServerFn(getBtcMarkets);
  const fireFn = useServerFn(recordPaperFire);
  const qc = useQueryClient();
  const [pending, setPending] = useState<"YES" | "NO" | null>(null);

  const q = useQuery({
    queryKey: ["kalshiOddsWidget"],
    queryFn: () => marketsFn(),
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 1_000,
  });

  const betM = useMutation({
    mutationFn: (args: { ticker: string; closeTime: string; side: "YES" | "NO"; askProb: number; snapshot: any }) => {
      const priceCents = Math.max(1, Math.min(100, Math.round(args.askProb * 100)));
      const contracts = Math.max(1, Math.floor(1000 / priceCents)); // $10 stake / price
      return fireFn({
        data: {
          ticker: args.ticker,
          closeTime: args.closeTime,
          button: "manual",
          side: args.side,
          contracts,
          fillPriceCents: priceCents,
          snapshot: args.snapshot,
        },
      });
    },
    onSuccess: (r: any, vars) => {
      setPending(null);
      if (r?.ok) {
        toast.success(`Paper bet placed: ${vars.side === "YES" ? "UP" : "DOWN"}`, {
          description: `Balance: $${(r.balanceCents / 100).toFixed(2)}`,
        });
        qc.invalidateQueries({ queryKey: ["paperBalance"] });
        qc.invalidateQueries({ queryKey: ["paperFills"] });
        qc.invalidateQueries({ queryKey: ["paperStats"] });
      } else {
        toast.error("Paper bet rejected", { description: r?.reason ?? "unknown" });
      }
    },
    onError: (e: any) => {
      setPending(null);
      toast.error("Paper bet failed", { description: e?.message ?? String(e) });
    },
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

  const placeBet = (side: "YES" | "NO") => {
    if (!market.closeTime) return;
    if (secsToClose <= 5) {
      toast.error("Market closing — try next window");
      return;
    }
    const askProb = side === "YES" ? market.yesAsk : market.noAsk;
    const label = side === "YES" ? "UP" : "DOWN";
    const priceCents = Math.max(1, Math.min(100, Math.round(askProb * 100)));
    if (!window.confirm(`Place $10 paper bet on ${label} @ ${priceCents}¢?\n\n${market.ticker}\nCloses in ${closeStr}`)) return;
    setPending(side);
    betM.mutate({
      ticker: market.ticker,
      closeTime: market.closeTime,
      side,
      askProb,
      snapshot: { source: "widget", spot, strike, yesAsk: market.yesAsk, noAsk: market.noAsk, secondsToClose: secsToClose },
    });
  };

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

      {/* Odds pills — Kalshi-style UP / DOWN. Clickable when enableBetting=true */}
      {enableBetting ? (
        <div className="flex items-stretch gap-2 w-full max-w-md">
          <button
            onClick={() => placeBet("YES")}
            disabled={betM.isPending || secsToClose <= 5}
            className={`flex-1 px-4 py-3 rounded-lg font-bold tracking-wide text-sm border transition ${
              winning === "UP"
                ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/35"
                : "bg-muted/40 text-foreground border-border hover:bg-emerald-500/15 hover:text-emerald-300"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {pending === "YES" && betM.isPending ? "…" : `UP ${upOdds}`}
          </button>
          <button
            onClick={() => placeBet("NO")}
            disabled={betM.isPending || secsToClose <= 5}
            className={`flex-1 px-4 py-3 rounded-lg font-bold tracking-wide text-sm border transition ${
              winning === "DOWN"
                ? "bg-red-500/25 text-red-300 border-red-500/50 hover:bg-red-500/35"
                : "bg-muted/40 text-foreground border-border hover:bg-red-500/15 hover:text-red-300"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {pending === "NO" && betM.isPending ? "…" : `DOWN ${downOdds}`}
          </button>
        </div>
      ) : (
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
      )}

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
        <span>{enableBetting ? "Tap UP or DOWN to place a $10 paper bet" : "Read-only"}</span>
      </div>
    </div>
  );
}
