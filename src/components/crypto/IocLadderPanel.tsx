import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIocLadderStats } from "@/lib/iocLadderStats.functions";

// IOC Ladder widget
// Read-only. Success rate, avg cents climbed, P&L per attempt bucket.
export function IocLadderPanel() {
  const fn = useServerFn(getIocLadderStats);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ioc-ladder-stats"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          IOC Retry Ladder — last {data?.windowDays ?? 7}d
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {isFetching ? "…" : "refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !data || data.totalAttempts === 0 ? (
        <div className="text-xs text-muted-foreground">
          No ladder attempts yet in this window.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat
              label="Success rate"
              value={`${data.successRatePct.toFixed(1)}%`}
              sub={`${data.filledCount}/${data.totalAttempts} filled`}
            />
            <Stat
              label="Avg climb"
              value={`+${data.avgClimbCents.toFixed(2)}¢`}
              sub={`on ${data.filledCount} fills`}
            />
            <Stat
              label="Total P&L"
              value={`${data.totalPnlUsd >= 0 ? "+" : ""}$${data.totalPnlUsd.toFixed(2)}`}
              sub={`${data.exhaustedCount} exhausted`}
              positive={data.totalPnlUsd >= 0}
            />
          </div>

          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            P&L by cents climbed
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left py-1 pr-3">Climb</th>
                  <th className="text-right py-1 pr-3">Fills</th>
                  <th className="text-right py-1 pr-3">W / L</th>
                  <th className="text-right py-1 pr-3">Total P&L</th>
                  <th className="text-right py-1">Avg P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map(b => (
                  <tr key={b.climbedCents} className="border-t border-border/50">
                    <td className="py-1 pr-3">
                      {b.climbedCents === 0 ? "first shot" : `+${b.climbedCents}¢`}
                    </td>
                    <td className="text-right py-1 pr-3">{b.count}</td>
                    <td className="text-right py-1 pr-3">
                      <span className="text-emerald-500">{b.wins}</span>
                      {" / "}
                      <span className="text-rose-500">{b.losses}</span>
                    </td>
                    <td className={`text-right py-1 pr-3 ${b.pnlUsd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {b.pnlUsd >= 0 ? "+" : ""}${b.pnlUsd.toFixed(2)}
                    </td>
                    <td className={`text-right py-1 ${b.avgPnlUsd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {b.avgPnlUsd >= 0 ? "+" : ""}${b.avgPnlUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label, value, sub, positive,
}: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${positive === false ? "text-rose-500" : positive === true ? "text-emerald-500" : ""}`}>
        {value}
      </div>
      {sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
