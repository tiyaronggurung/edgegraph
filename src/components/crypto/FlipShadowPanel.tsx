import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getFlipShadowReport,
  recomputeFlipShadow,
} from "@/lib/flipShadow.functions";

// Shadow Flip Exit Study — READ-ONLY simulation panel.
// No live exits are triggered. Simulates exiting each settled trade the
// moment our-side mark first crossed 45¢ / 40¢ / 35¢ / 30¢, then compares
// simulated PnL against actual PnL. Used to decide whether an early-exit
// rule should ever be promoted to live.
export function FlipShadowPanel() {
  const getFn = useServerFn(getFlipShadowReport);
  const recomputeFn = useServerFn(recomputeFlipShadow);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["flip-shadow-report"],
    queryFn: () => getFn(),
    refetchInterval: 120_000,
  });

  const recompute = useMutation({
    mutationFn: () => recomputeFn(),
    onSuccess: () => refetch(),
  });

  return (
    <div className="rounded-lg border border-amber-500/40 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          Shadow Flip Exit Study
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {recompute.isPending ? "recomputing…" : "recompute"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {isFetching ? "…" : "refresh"}
          </button>
        </div>
      </div>

      <div className="text-[11px] text-amber-500/90 mb-3">
        No live exits triggered — simulation only.
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !data || data.totalSettled === 0 ? (
        <div className="text-xs text-muted-foreground">
          No settled trades yet. Click <span className="text-foreground">recompute</span> to backfill.
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3">
            {data.totalSettled} settled · actual PnL{" "}
            <span className={data.actualPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
              {data.actualPnl >= 0 ? "+" : ""}${data.actualPnl.toFixed(2)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-3">Rule</th>
                  <th className="py-1 pr-3">Exits</th>
                  <th className="py-1 pr-3">Saved / Killed</th>
                  <th className="py-1 pr-3">Loss avoided</th>
                  <th className="py-1 pr-3">Profit given up</th>
                  <th className="py-1 pr-3">Net prevented</th>
                  <th className="py-1 pr-3">Shakeout %</th>
                  <th className="py-1 pr-3">Avg min left</th>
                  <th className="py-1 pr-3">Δ vs actual</th>
                </tr>
              </thead>
              <tbody>
                {data.thresholds.map((t) => {
                  const shakeoutPct = t.shakeout_rate == null ? null : t.shakeout_rate * 100;
                  return (
                    <tr key={t.threshold} className="border-t border-border/40">
                      <td className="py-1 pr-3">mark &lt; {t.threshold}¢</td>
                      <td className="py-1 pr-3">{t.exits}</td>
                      <td className="py-1 pr-3">
                        <span className="text-emerald-400">{t.losses_saved}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-red-400">{t.winners_killed}</span>
                      </td>
                      <td className="py-1 pr-3 text-emerald-400">
                        +${t.total_loss_avoided.toFixed(2)}
                      </td>
                      <td className="py-1 pr-3 text-red-400">
                        −${t.total_profit_given_up.toFixed(2)}
                      </td>
                      <td
                        className={
                          "py-1 pr-3 " +
                          (t.net_damage_prevented > 0
                            ? "text-emerald-400"
                            : t.net_damage_prevented < 0
                            ? "text-red-400"
                            : "text-muted-foreground")
                        }
                      >
                        {t.net_damage_prevented >= 0 ? "+" : ""}${t.net_damage_prevented.toFixed(2)}
                      </td>
                      <td
                        className={
                          "py-1 pr-3 " +
                          (shakeoutPct == null
                            ? "text-muted-foreground"
                            : shakeoutPct >= 50
                            ? "text-red-400"
                            : shakeoutPct >= 25
                            ? "text-amber-400"
                            : "text-emerald-400")
                        }
                      >
                        {shakeoutPct == null ? "—" : `${shakeoutPct.toFixed(0)}%`}
                      </td>
                      <td className="py-1 pr-3 text-muted-foreground">
                        {t.avg_minutes_remaining == null ? "—" : `${t.avg_minutes_remaining.toFixed(1)}m`}
                      </td>
                      <td
                        className={
                          "py-1 pr-3 " +
                          (t.delta_pnl > 0
                            ? "text-emerald-400"
                            : t.delta_pnl < 0
                            ? "text-red-400"
                            : "text-muted-foreground")
                        }
                      >
                        {t.delta_pnl >= 0 ? "+" : ""}${t.delta_pnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] text-muted-foreground mt-3 leading-relaxed space-y-1">
            <div>
              <span className="text-foreground">Loss avoided</span> = damage the shadow exit would have prevented on losing trades.
              <span className="text-foreground"> Profit given up</span> = winning PnL sacrificed when the shadow exit fired on a trade that later won.
              <span className="text-foreground"> Net prevented</span> = avoided − given up.
            </div>
            <div>
              <span className="text-foreground">Shakeout %</span> = share of shadow exits where our-side mark later recovered to entry + 12¢ (the TP target) before settle.
              High % means we&apos;d be exiting on temporary dips; low % means genuine reversals.
              <span className="text-foreground"> Avg min left</span> = minutes remaining in the contract when the flip fired.
            </div>
            <div>
              Promotion requires meaningful net damage prevented with a low shakeout rate across 50–100 forward trades.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
