import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSkipBucketReport } from "@/lib/lossCapShadow.functions";

// Fix #1 — SHADOW REPORT ONLY. Read-only. Not wired into buy path.
// Shows what a "skip <30¢ AND 50–69¢" filter would have saved on real settled trades.
export function SkipBucketPanel() {
  const fn = useServerFn(getSkipBucketReport);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["skip-bucket-report"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  return (
    <div className="rounded-lg border border-emerald-500/40 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          Fix #1 — Skip Bucket Shadow
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {isFetching ? "…" : "refresh"}
        </button>
      </div>
      <div className="text-[11px] text-emerald-500/90 mb-3">
        Report only. Buy path unchanged. Flip live after 1 day confirms savings.
      </div>

      {!data ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : data.total_settled === 0 ? (
        <div className="text-xs text-muted-foreground">No settled trades yet.</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3">
            {data.total_settled} settled · net{" "}
            <span className={data.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
              {data.total_pnl >= 0 ? "+" : ""}${data.total_pnl.toFixed(2)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-3">Entry price</th>
                  <th className="py-1 pr-3">N</th>
                  <th className="py-1 pr-3">Win rate</th>
                  <th className="py-1 pr-3">Total PnL</th>
                  <th className="py-1 pr-3">Avg PnL</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b) => {
                  const poison = b.label.includes("longshot") || b.label.includes("coinflip");
                  return (
                    <tr key={b.label} className={"border-t border-border/40 " + (poison ? "bg-red-500/5" : "")}>
                      <td className="py-1 pr-3">{b.label}</td>
                      <td className="py-1 pr-3">{b.n}</td>
                      <td className={"py-1 pr-3 " + (b.win_rate >= 0.55 ? "text-emerald-400" : b.win_rate <= 0.4 ? "text-red-400" : "text-muted-foreground")}>
                        {(b.win_rate * 100).toFixed(0)}%
                      </td>
                      <td className={"py-1 pr-3 " + (b.total_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {b.total_pnl >= 0 ? "+" : ""}${b.total_pnl.toFixed(2)}
                      </td>
                      <td className={"py-1 pr-3 " + (b.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {b.avg_pnl >= 0 ? "+" : ""}${b.avg_pnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded border border-border/40 p-2 text-[11px] text-muted-foreground">
            <div className="text-foreground mb-1">{data.proposed_filter.label}</div>
            Would skip <span className="text-foreground">{data.proposed_filter.would_skip_n}</span> trades ·{" "}
            saved <span className="text-emerald-400">+${data.proposed_filter.losses_saved_usd.toFixed(2)}</span> in losses ·{" "}
            gave up <span className="text-red-400">−${data.proposed_filter.wins_killed_usd.toFixed(2)}</span> in wins ·{" "}
            net{" "}
            <span className={data.proposed_filter.net_usd >= 0 ? "text-emerald-400" : "text-red-400"}>
              {data.proposed_filter.net_usd >= 0 ? "+" : ""}${data.proposed_filter.net_usd.toFixed(2)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
