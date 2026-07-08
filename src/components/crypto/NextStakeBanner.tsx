import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOddsShadowReport } from "@/lib/oddsShadowTrader.functions";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";

// Banner above the Live Kalshi auto-trade section: shows the next stake
// the Profit Bank Ladder would fire, plus unlock streak / ladder level.
export function NextStakeBanner() {
  const report = useServerFn(getOddsShadowReport);
  const { data } = useQuery({
    queryKey: ["oddsShadowReport"],
    queryFn: () => report(),
    refetchInterval: 5_000,
  });
  const r = data && data.ok ? data : null;
  if (!r || !r.bankroll) return null;
  const b = r.bankroll as typeof r.bankroll & {
    winStreak?: number;
    unlockNeeded?: number;
    consecutiveLosses?: number;
    currentLadderLevel?: number;
    highestProfitBank?: number;
    maxStake?: number;
  };
  const streak = b.winStreak ?? 0;
  const need = b.unlockNeeded ?? 3;
  const unlocked = b.mode === "profit";
  const losses = b.consecutiveLosses ?? 0;
  const level = b.currentLadderLevel ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2.5 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Next stake</span>
        </div>
        <div className="font-mono text-lg font-semibold">${b.nextStake.toFixed(2)}</div>
        <Badge variant={unlocked ? "default" : "outline"} className="text-[9px]">
          {unlocked ? `PROFIT L${level}` : "BASE"}
        </Badge>
        {b.maxStake ? (
          <span className="text-[10px] text-muted-foreground">cap ${b.maxStake}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-[11px] flex-wrap">
        {!unlocked ? (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Unlock</span>
            <div className="flex gap-1">
              {Array.from({ length: need }).map((_, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full border ${
                    i < streak
                      ? "bg-emerald-500 border-emerald-400"
                      : "bg-transparent border-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
            <span className="font-mono">{streak}/{need}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Losses</span>
            <span className={`font-mono ${losses > 0 ? "text-red-400" : ""}`}>{losses}/3</span>
          </div>
        )}
        <div className="text-muted-foreground">
          bank <span className={b.bank > 0 ? "text-emerald-400" : "text-red-400"}>${b.bank.toFixed(2)}</span>
        </div>
        {b.highestProfitBank !== undefined ? (
          <div className="text-muted-foreground">peak <span className="font-mono">${b.highestProfitBank.toFixed(2)}</span></div>
        ) : null}
      </div>
    </div>
  );
}
