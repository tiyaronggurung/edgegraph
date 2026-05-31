import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { getCashoutSignals, type CashoutSignal } from "@/lib/bets.functions";

interface Props {
  marketTicker: string;
  side: "YES" | "NO";
}

/**
 * Inline live P/L strip rendered on a VerdictCard the user has bet on.
 * Reuses the same `getCashoutSignals` server fn (cached by react-query,
 * so N cards = 1 network call), refreshes every 30s.
 */
export function LiveBetPL({ marketTicker, side }: Props) {
  const fetchSignals = useServerFn(getCashoutSignals);
  const { data } = useQuery({
    queryKey: ["cashout-signals-live"],
    queryFn: () => fetchSignals(),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const signal: CashoutSignal | undefined = data?.signals.find(
    (s) => s.ticker === marketTicker && s.side === side,
  );
  if (!signal) return null;

  const up = signal.estPl > 0.01;
  const down = signal.estPl < -0.01;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const tone = up
    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
    : down
      ? "border-red-500/50 bg-red-500/10 text-red-300"
      : "border-white/15 bg-white/5 text-white/70";

  const tierLabel =
    signal.tier === "LOCK_PROFIT"
      ? "LOCK PROFIT"
      : signal.tier === "CUT_LOSS"
        ? "CUT LOSS"
        : "HOLD";
  const tierTone =
    signal.tier === "LOCK_PROFIT"
      ? "bg-emerald-500 text-black"
      : signal.tier === "CUT_LOSS"
        ? "bg-red-500 text-white"
        : "bg-white/10 text-white/70";

  const pct = ((signal.ratio - 1) * 100).toFixed(0);
  const pctStr = signal.ratio >= 1 ? `+${pct}%` : `${pct}%`;

  return (
    <div className={`mt-2 border rounded px-2 py-1.5 text-[10px] ${tone}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="font-bold uppercase tracking-wider">Your bet</span>
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold ${tierTone}`}>
          {tierLabel}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono">
        <span className="opacity-70">
          {(signal.entryPrice * 100).toFixed(0)}¢ → {(signal.currentPrice * 100).toFixed(0)}¢
        </span>
        <span className="ml-auto font-bold">
          {signal.estPl >= 0 ? "+" : ""}${signal.estPl.toFixed(2)} ({pctStr})
        </span>
      </div>
      <div className="mt-0.5 opacity-70 leading-snug">{signal.reason}</div>
    </div>
  );
}
