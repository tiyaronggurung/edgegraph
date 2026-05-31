import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  getCashoutSignals,
  cashOutBet,
  type CashoutSignal,
} from "@/lib/bets.functions";
import { TrendingUp, TrendingDown, Minus, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function CashoutAlerts() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const signalsFn = useServerFn(getCashoutSignals);
  const cashOutFn = useServerFn(cashOutBet);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["cashout-signals", user?.id],
    queryFn: () => signalsFn(),
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  async function handleCashOut(s: CashoutSignal) {
    if (busyId) return;
    setBusyId(s.verdictId);
    try {
      const res = await cashOutFn({
        data: { verdictId: s.verdictId, exitPrice: s.currentPrice },
      });
      const sign = res.pl >= 0 ? "+" : "";
      toast.success(`Cashed out: ${sign}$${res.pl.toFixed(2)}`);
      qc.invalidateQueries({ queryKey: ["cashout-signals", user?.id] });
      qc.invalidateQueries({ queryKey: ["verdict-log", user?.id] });
      qc.invalidateQueries({ queryKey: ["verdict-log-bets", user?.id] });
      qc.invalidateQueries({ queryKey: ["bankroll-stats"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!user) return null;
  const signals = q.data?.signals ?? [];
  const actionable = signals.filter((s) => s.tier !== "HOLD");

  if (q.isLoading) {
    return (
      <div className="border border-border bg-card rounded p-3 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Scanning pending bets for cashout signals…
      </div>
    );
  }

  if (signals.length === 0) return null;

  return (
    <section className="border border-border bg-card rounded overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Cashout Alerts
          </div>
          <div className="text-sm font-bold">
            {actionable.length > 0 ? (
              <span className="text-[color:var(--color-primary)]">
                {actionable.length} actionable signal{actionable.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="text-muted-foreground">
                All {signals.length} pending bet{signals.length === 1 ? "" : "s"} on track — hold
              </span>
            )}
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Lock ≥ +40% · Cut ≤ −45%
        </div>
      </div>
      <div className="divide-y divide-border">
        {signals.map((s) => {
          const isLock = s.tier === "LOCK_PROFIT";
          const isCut = s.tier === "CUT_LOSS";
          const tone = isLock
            ? "bg-emerald-500/5"
            : isCut
              ? "bg-red-500/5"
              : "";
          const Icon = isLock ? TrendingUp : isCut ? TrendingDown : Minus;
          const iconTone = isLock
            ? "text-emerald-400"
            : isCut
              ? "text-red-400"
              : "text-muted-foreground";
          const badge = isLock
            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
            : isCut
              ? "border-red-500/60 bg-red-500/10 text-red-400"
              : "border-border bg-muted/30 text-muted-foreground";
          const badgeText = isLock ? "LOCK PROFIT" : isCut ? "CUT LOSS" : "HOLD";
          const plTone = s.estPl >= 0 ? "text-emerald-400" : "text-red-400";
          return (
            <div key={s.verdictId} className={`p-3 flex items-center gap-3 ${tone}`}>
              <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 ${badge}`}
                  >
                    {badgeText}
                  </span>
                  <span className="text-xs font-medium truncate">
                    {s.sideLabel ?? s.side} · {s.title ?? s.ticker}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">{s.reason}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  Entry {s.entryPrice.toFixed(2)} → Now {s.currentPrice.toFixed(2)} · Stake $
                  {s.stake.toFixed(0)} · Est value ${s.estValue.toFixed(2)} ·{" "}
                  <span className={plTone}>
                    {s.estPl >= 0 ? "+" : ""}${s.estPl.toFixed(2)}
                  </span>
                </div>
              </div>
              {s.tier !== "HOLD" && (
                <button
                  onClick={() => handleCashOut(s)}
                  disabled={busyId === s.verdictId}
                  className={`shrink-0 px-3 py-1.5 text-xs uppercase tracking-wider rounded border font-bold ${
                    isLock
                      ? "border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/20"
                      : "border-red-500/60 text-red-400 hover:bg-red-500/20"
                  } disabled:opacity-50`}
                  title="Marks bet as settled in your P/L at current price. Sell on Kalshi.com to actually exit."
                >
                  {busyId === s.verdictId ? (
                    <Loader2 className="h-3 w-3 animate-spin inline" />
                  ) : (
                    "Cash Out"
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="p-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3" />
        Cash Out records the partial settle in your P/L. To actually exit the position, sell on Kalshi.com first.
      </div>
    </section>
  );
}
