import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAutoTradeOrders } from "@/lib/cryptoAutoTrade.functions";
import { getTaShadowReport, logTaShadow, settleTaShadow, type TaShadowLogInput } from "@/lib/taShadow.functions";
import { useBinanceBtcCandles } from "@/hooks/useBinanceBtcCandles";
import { getChartVerdict } from "@/lib/ta/chartVerdict";

// TA Shadow Study — READ-ONLY. Logs TA verdicts alongside every auto-trade
// order and reports how often TA agrees/disagrees with Kalshi and the model.
// NOT a live gate. NOT wired into buy/exit/ladder paths.
export function TaShadowPanel() {
  const reportFn = useServerFn(getTaShadowReport);
  const logFn = useServerFn(logTaShadow);
  const settleFn = useServerFn(settleTaShadow);
  const listFn = useServerFn(listAutoTradeOrders);

  const { candles1m, candles5m, error: candlesErr } = useBinanceBtcCandles();

  const { data: report, refetch, isFetching } = useQuery({
    queryKey: ["ta-shadow-report"],
    queryFn: () => reportFn(),
    refetchInterval: 60_000,
  });

  const { data: orders } = useQuery({
    queryKey: ["ta-shadow-orders-tap"],
    queryFn: () => listFn(),
    refetchInterval: 20_000,
  });

  const settle = useMutation({
    mutationFn: () => settleFn(),
    onSuccess: () => refetch(),
  });

  // Auto-log any freshly placed order with the current TA verdict.
  const loggedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!orders?.orders?.length || !candles1m.length || !candles5m.length) return;
    const verdict = getChartVerdict(candles1m, candles5m);

    for (const o of orders.orders) {
      if (loggedRef.current.has(o.id)) continue;
      // Only log orders that are placed or settled (i.e. real trades taken).
      if (!["placed", "settled_win", "settled_loss"].includes(o.status ?? "")) continue;
      loggedRef.current.add(o.id);

      const modelProb = o.model_prob == null ? null : Number(o.model_prob);
      const edge = o.edge_pts == null ? null : Number(o.edge_pts);
      const kalshiDir: "YES" | "NO" | "neutral" =
        edge == null || edge === 0 ? "neutral" : edge > 0 ? "YES" : "NO";
      const modelDir: "YES" | "NO" | "neutral" =
        modelProb == null ? "neutral" : modelProb > 0.52 ? "YES" : modelProb < 0.48 ? "NO" : "neutral";

      const payload: TaShadowLogInput = {
        order_id: o.id,
        ticker: o.ticker ?? null,
        side_evaluated: o.side ?? null,
        kalshi_price_cents: o.entry_price_cents ?? null,
        model_prob: modelProb,
        edge_pts: edge,
        kalshi_direction: kalshiDir,
        model_direction: modelDir,
        ta_direction_1m: verdict.tf1m.direction,
        ta_direction_5m: verdict.tf5m.direction,
        ta_direction_combined: verdict.combined.direction,
        ta_confidence: verdict.combined.confidence,
        ta_reasons: verdict.combined.reasons,
        trend_1m: verdict.tf1m.trend,
        trend_5m: verdict.tf5m.trend,
        support_level: verdict.tf5m.support,
        resistance_level: verdict.tf5m.resistance,
        nearest_round_level: verdict.roundLevel,
        rejection_wick_flag: verdict.tf1m.rejectionFlag || verdict.tf5m.rejectionFlag,
      };
      logFn({ data: payload }).catch(() => {
        // fire-and-forget — never disrupt live trading
        loggedRef.current.delete(o.id);
      });
    }
  }, [orders, candles1m, candles5m, logFn]);

  const verdict = candles1m.length && candles5m.length ? getChartVerdict(candles1m, candles5m) : null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          TA Shadow Study
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => settle.mutate()}
            disabled={settle.isPending}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {settle.isPending ? "settling…" : "settle outcomes"}
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
        No live gate. Logging only. Promote after 100–200 forward trades prove edge.
      </div>

      {/* Live TA snapshot */}
      {verdict ? (
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          <div className="rounded border border-border/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Live TA verdict</div>
            <div>
              <span className="text-muted-foreground">combined:</span>{" "}
              <span className={verdict.combined.direction === "YES" ? "text-emerald-400" : verdict.combined.direction === "NO" ? "text-red-400" : "text-muted-foreground"}>
                {verdict.combined.direction}
              </span>{" "}
              <span className="text-muted-foreground">({(verdict.combined.confidence * 100).toFixed(0)}%)</span>
            </div>
            <div className="text-muted-foreground">
              1m: {verdict.tf1m.direction} · trend {verdict.tf1m.trend}
            </div>
            <div className="text-muted-foreground">
              5m: {verdict.tf5m.direction} · trend {verdict.tf5m.trend}
            </div>
          </div>
          <div className="rounded border border-border/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Levels (5m)</div>
            <div className="text-muted-foreground">
              price: <span className="text-foreground">${verdict.price?.toFixed(0)}</span>
            </div>
            <div className="text-muted-foreground">
              support: <span className="text-emerald-400">{verdict.tf5m.support?.toFixed(0) ?? "—"}</span>
            </div>
            <div className="text-muted-foreground">
              resistance: <span className="text-red-400">{verdict.tf5m.resistance?.toFixed(0) ?? "—"}</span>
            </div>
            <div className="text-muted-foreground">
              nearest round: <span className="text-foreground">{verdict.roundLevel ?? "—"}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground mb-3">
          {candlesErr ? `candles error: ${candlesErr}` : "loading candles…"}
        </div>
      )}

      {!report || report.total === 0 ? (
        <div className="text-xs text-muted-foreground">
          No shadow rows yet. Rows are logged automatically as auto-trade orders are placed.
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground mb-3">
            {report.total} logged · {report.settled} settled
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-3">Bucket</th>
                  <th className="py-1 pr-3">N</th>
                  <th className="py-1 pr-3">Win rate</th>
                  <th className="py-1 pr-3">Avg PnL</th>
                  <th className="py-1 pr-3">Full-loss %</th>
                </tr>
              </thead>
              <tbody>
                {report.buckets.map((b) => (
                  <tr key={b.bucket} className="border-t border-border/40">
                    <td className="py-1 pr-3">{b.bucket}</td>
                    <td className="py-1 pr-3">{b.n}</td>
                    <td className={"py-1 pr-3 " + (b.win_rate >= 0.55 ? "text-emerald-400" : b.win_rate <= 0.4 ? "text-red-400" : "text-muted-foreground")}>
                      {b.n ? `${(b.win_rate * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className={"py-1 pr-3 " + (b.avg_pnl > 0 ? "text-emerald-400" : b.avg_pnl < 0 ? "text-red-400" : "text-muted-foreground")}>
                      {b.n ? `${b.avg_pnl >= 0 ? "+" : ""}$${b.avg_pnl.toFixed(2)}` : "—"}
                    </td>
                    <td className={"py-1 pr-3 " + (b.full_loss_rate >= 0.3 ? "text-red-400" : "text-muted-foreground")}>
                      {b.n ? `${(b.full_loss_rate * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-[11px] text-muted-foreground">
            Hypothetical: if we required <span className="text-foreground">all 3 to agree</span>, we&apos;d have skipped{" "}
            <span className="text-foreground">{report.hypothetical_all_three_gate.would_skip}</span> trades ·{" "}
            saved <span className="text-emerald-400">+${report.hypothetical_all_three_gate.losses_saved_usd.toFixed(2)}</span> in losses ·{" "}
            gave up <span className="text-red-400">−${report.hypothetical_all_three_gate.wins_killed_usd.toFixed(2)}</span> in wins ·{" "}
            net{" "}
            <span className={report.hypothetical_all_three_gate.net_usd >= 0 ? "text-emerald-400" : "text-red-400"}>
              {report.hypothetical_all_three_gate.net_usd >= 0 ? "+" : ""}${report.hypothetical_all_three_gate.net_usd.toFixed(2)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
