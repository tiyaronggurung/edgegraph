import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getScalpShadowReport } from "@/lib/scalpShadow.functions";

// Scalp Shadow — READ-ONLY simulation panel.
// Nothing here places orders. Just measures whether the two scalp setups
// (cliff / compression) actually produce edge on real Kalshi 15m tape.
export function ScalpShadowPanel() {
  const getFn = useServerFn(getScalpShadowReport);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["scalp-shadow-report"],
    queryFn: () => getFn(),
    refetchInterval: 15_000,
  });

  const fmtPnl = (n: number | null | undefined) => {
    if (n === null || n === undefined) return "—";
    const s = n > 0 ? "+" : "";
    return `${s}${n}¢`;
  };

  return (
    <div className="rounded-lg border border-cyan-500/40 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          Scalp Shadow
        </h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {isFetching ? "…" : "refresh"}
        </button>
      </div>

      <div className="text-[11px] text-cyan-500/90 mb-3">
        Observer only — no live orders. Cliff = fade extreme &gt;4m out ·
        Compression = fade 60s spike near strike.
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !data ? (
        <div className="text-xs text-muted-foreground">No data yet.</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(["cliff", "compression"] as const).map((k) => {
              const s = data.summary[k];
              return (
                <div key={k} className="rounded border border-border p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {k}
                  </div>
                  {s.n === 0 ? (
                    <div className="text-muted-foreground">no closed trades</div>
                  ) : (
                    <div className="mt-0.5">
                      <div>
                        {s.wins}/{s.n} · {s.hitRate}%
                      </div>
                      <div className="text-muted-foreground">
                        avg {fmtPnl(s.avgPnl)} · total {fmtPnl(s.totalPnl)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Open ({data.open.length})
            </div>
            {data.open.length === 0 ? (
              <div className="text-xs text-muted-foreground">None open.</div>
            ) : (
              <div className="space-y-1 text-xs">
                {data.open.map((p) => (
                  <div
                    key={p.id}
                    className="flex justify-between rounded border border-border/60 px-2 py-1"
                  >
                    <span>
                      <span className="text-muted-foreground">{p.setup_kind}</span>{" "}
                      {p.entry_side} @ {p.entry_cents}¢
                    </span>
                    <span className="text-muted-foreground">
                      ttc {p.seconds_to_close_at_entry}s · Δ$
                      {Math.round(Number(p.entry_dist_to_strike))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Recent closed
            </div>
            {data.closed.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                None yet — waiting for setups.
              </div>
            ) : (
              <div className="space-y-1 text-xs max-h-64 overflow-y-auto">
                {data.closed.slice(0, 20).map((p) => {
                  const pnl = p.pnl_cents ?? 0;
                  return (
                    <div
                      key={p.id}
                      className="flex justify-between rounded border border-border/60 px-2 py-1"
                    >
                      <span>
                        <span className="text-muted-foreground">{p.setup_kind}</span>{" "}
                        {p.entry_side} {p.entry_cents}¢→{p.exit_cents}¢
                      </span>
                      <span
                        className={
                          pnl > 0
                            ? "text-emerald-500"
                            : pnl < 0
                              ? "text-rose-500"
                              : "text-muted-foreground"
                        }
                      >
                        {fmtPnl(pnl)}{" "}
                        <span className="text-muted-foreground">
                          · {p.exit_reason}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
