import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLossCapReport } from "@/lib/lossCapShadow.functions";

// Fix #2 — SHADOW REPORT ONLY. Read-only. Not wired into exit path.
// Simulates a hard -$CAP loss cap on existing flip_shadow rows using min_mark_seen.
export function LossCapPanel() {
  const [cap, setCap] = useState(30);
  const fn = useServerFn(getLossCapReport);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["loss-cap-report", cap],
    queryFn: () => fn({ data: { cap_usd: cap } }),
    refetchInterval: 60_000,
  });

  return (
    <div className="rounded-lg border border-orange-500/40 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          Fix #2 — Hard Loss Cap Shadow
        </h2>
        <div className="flex items-center gap-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">cap $</label>
          <input
            type="number"
            value={cap}
            onChange={(e) => setCap(Math.max(5, Math.min(200, Number(e.target.value) || 30)))}
            className="w-14 bg-background border border-border/40 rounded px-1 py-0.5 text-xs"
          />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {isFetching ? "…" : "refresh"}
          </button>
        </div>
      </div>
      <div className="text-[11px] text-orange-500/90 mb-3">
        Simulation only. Exit logic unchanged. Uses flip_shadow min_mark_seen to test −${cap} cap.
      </div>

      {!data ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : data.eligible === 0 ? (
        <div className="text-xs text-muted-foreground">
          No eligible flip_shadow rows with min_mark_seen and pnl.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
            <div className="rounded border border-border/40 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">Eligible rows</div>
              <div>{data.eligible} / {data.total_flip_rows}</div>
            </div>
            <div className="rounded border border-border/40 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">Cap would fire</div>
              <div>{data.cap_would_fire} ({data.eligible ? ((data.cap_would_fire / data.eligible) * 100).toFixed(0) : 0}%)</div>
            </div>
            <div className="rounded border border-border/40 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">Actual PnL (sample)</div>
              <div className={data.actual_pnl_sample >= 0 ? "text-emerald-400" : "text-red-400"}>
                {data.actual_pnl_sample >= 0 ? "+" : ""}${data.actual_pnl_sample.toFixed(2)}
              </div>
            </div>
            <div className="rounded border border-border/40 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">Simulated PnL</div>
              <div className={data.simulated_pnl_sample >= 0 ? "text-emerald-400" : "text-red-400"}>
                {data.simulated_pnl_sample >= 0 ? "+" : ""}${data.simulated_pnl_sample.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="rounded border border-border/40 p-2 text-[11px] text-muted-foreground">
            Losses saved <span className="text-emerald-400">+${data.saved_losses_usd.toFixed(2)}</span> ·{" "}
            Wins killed <span className="text-red-400">−${data.killed_wins_usd.toFixed(2)}</span> ·{" "}
            Net{" "}
            <span className={data.net_usd >= 0 ? "text-emerald-400" : "text-red-400"}>
              {data.net_usd >= 0 ? "+" : ""}${data.net_usd.toFixed(2)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
