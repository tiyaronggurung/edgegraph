// Verdict Auto-Bet control panel — real money only, $10 flat, one buy per
// window, fires only when the verdict holds across two recorded ticks.
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getVerdictBetSettings,
  setVerdictBetEnabled,
  setVerdictBetLive,
  getVerdictBetTrades,
} from "@/lib/verdictAutoBet.functions";

export function VerdictBetPanel() {
  const qc = useQueryClient();
  const settingsFn = useServerFn(getVerdictBetSettings);
  const tradesFn = useServerFn(getVerdictBetTrades);
  const enableFn = useServerFn(setVerdictBetEnabled);
  const liveFn = useServerFn(setVerdictBetLive);

  const { data: s } = useQuery({
    queryKey: ["verdict-bet-settings"],
    queryFn: () => settingsFn(),
    refetchInterval: 15_000,
  });
  const { data: t } = useQuery({
    queryKey: ["verdict-bet-trades"],
    queryFn: () => tradesFn(),
    refetchInterval: 20_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["verdict-bet-settings"] });
    void qc.invalidateQueries({ queryKey: ["verdict-bet-trades"] });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Verdict Auto-Bet — real money</span>
          <Badge
            className={
              s?.enabled && s?.live
                ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                : "border border-border/60 bg-muted text-muted-foreground"
            }
          >
            {s?.enabled ? (s?.live ? "LIVE" : "ARMED · live off") : "OFF"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span>Engine on</span>
          <Switch
            checked={!!s?.enabled}
            onCheckedChange={async (v) => {
              const r = await enableFn({ data: { enabled: v } });
              if (!r.ok) toast.error(r.error);
              else toast.success(v ? "Verdict betting armed from the next window" : "Verdict betting off");
              refresh();
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Real money</span>
          <Switch
            checked={!!s?.live}
            onCheckedChange={async (v) => {
              const r = await liveFn({ data: { live: v } });
              if (!r.ok) toast.error(r.error);
              else toast.success(v ? "Real money enabled" : "Real money disabled");
              refresh();
            }}
          />
        </div>
        <div className="border-t border-border/50 pt-2 font-mono text-[11px] text-muted-foreground">
          stake ${((s?.stakeCents ?? 1000) / 100).toFixed(2)} · one buy per window ·{" "}
          {t?.fires ?? 0} fires · {t?.wins ?? 0}W/{t?.losses ?? 0}L · P/L{" "}
          <span className={(t?.pnlUsd ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}>
            ${(t?.pnlUsd ?? 0).toFixed(2)}
          </span>
        </div>
        {!s?.hasKeys && (
          <p className="text-[10px] text-amber-400">
            Add your Kalshi keys in Settings before turning real money on.
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          buys the verdict side only when all three flow signals agree and the call holds across two
          recorded readings · skips any window another engine already bought
        </p>
      </CardContent>
    </Card>
  );
}
