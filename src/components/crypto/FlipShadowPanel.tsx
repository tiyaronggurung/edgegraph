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
                  <th className="py-1 pr-3">Saved loss</th>
                  <th className="py-1 pr-3">Killed winner</th>
                  <th className="py-1 pr-3">Sim PnL</th>
                  <th className="py-1 pr-3">Δ vs actual</th>
                </tr>
              </thead>
              <tbody>
                {data.thresholds.map((t) => (
                  <tr key={t.threshold} className="border-t border-border/40">
                    <td className="py-1 pr-3">mark &lt; {t.threshold}¢</td>
                    <td className="py-1 pr-3">{t.exits}</td>
                    <td className="py-1 pr-3 text-emerald-400">{t.losses_saved}</td>
                    <td className="py-1 pr-3 text-red-400">{t.winners_killed}</td>
                    <td className="py-1 pr-3">
                      {t.sim_pnl >= 0 ? "+" : ""}${t.sim_pnl.toFixed(2)}
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
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Sim exit price = mark on our side at first cross. Sim PnL = contracts × (exit − entry) / 100.
            No exit found → sim PnL equals actual PnL. Promotion requires meaningful loss reduction
            without materially killing winners across 50–100 forward trades.
          </div>
        </>
      )}
    </div>
  );
}
