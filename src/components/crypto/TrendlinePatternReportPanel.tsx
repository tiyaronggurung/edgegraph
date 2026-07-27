import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTrendlinePatternReport } from "@/lib/trendlinePatternReport.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  bull_wedge: "Bull Wedge",
  bear_wedge: "Bear Wedge",
  spike_up: "Spike ↑",
  spike_down: "Spike ↓",
};

export function TrendlinePatternReportPanel() {
  const fn = useServerFn(getTrendlinePatternReport);
  const { data, isLoading } = useQuery({
    queryKey: ["trendline-pattern-report"],
    queryFn: () => fn({}),
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Trendline Pattern Backtest</span>
          {data && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                mode: {data.config.booster_mode}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {data.total_settled.toLocaleString()} settled shadows
              </span>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No settled pattern rows yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 text-left">Pattern</th>
                    <th className="py-1.5 text-right">N</th>
                    <th className="py-1.5 text-right">Follow WR</th>
                    <th className="py-1.5 text-right">Fade WR</th>
                    <th className="py-1.5 text-right">Avg width%</th>
                    <th className="py-1.5 text-right">Avg swings</th>
                    <th className="py-1.5 text-right">Avg 15m ret%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const winner = r.follow_wr_pct >= r.fade_wr_pct ? "follow" : "fade";
                    return (
                      <tr key={r.pattern} className="border-b last:border-b-0">
                        <td className="py-1.5 font-medium">{LABELS[r.pattern] ?? r.pattern}</td>
                        <td className="py-1.5 text-right">{r.n}</td>
                        <td className={`py-1.5 text-right ${winner === "follow" ? "font-semibold text-green-600" : ""}`}>
                          {r.follow_wr_pct}%
                        </td>
                        <td className={`py-1.5 text-right ${winner === "fade" ? "font-semibold text-green-600" : ""}`}>
                          {r.fade_wr_pct}%
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">{r.avg_channel_width_pct ?? "—"}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{r.avg_swings ?? "—"}</td>
                        <td className={`py-1.5 text-right ${(r.avg_next_return_pct ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {r.avg_next_return_pct != null ? `${r.avg_next_return_pct > 0 ? "+" : ""}${r.avg_next_return_pct}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded border border-border/60 bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">Recommendation:</span> {data.recommendation}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
