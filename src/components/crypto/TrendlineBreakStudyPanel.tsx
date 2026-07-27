import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTrendlineBreakStudy, type TrendlineBreakRow } from "@/lib/trendlineBreakStudy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, { title: string; hint: string }> = {
  support_broken: { title: "BUY (support) broken", hint: "Spot pierced the lower trendline before close" },
  resist_broken: { title: "SELL (resistance) broken", hint: "Spot pierced the upper trendline before close" },
  both_broken: { title: "Both broken (chop)", hint: "Both lines pierced within the window" },
  both_held: { title: "Both held (channel intact)", hint: "Neither line broken" },
};

function pctUpTone(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 60) return "text-green-600 font-semibold";
  if (pct <= 40) return "text-red-600 font-semibold";
  return "text-muted-foreground";
}

function edgeTag(row: TrendlineBreakRow) {
  if (row.pct_up == null || row.n < 20) return null;
  const dev = row.pct_up - 50;
  if (Math.abs(dev) < 8) return <Badge variant="outline" className="text-[10px]">neutral</Badge>;
  const side = dev > 0 ? "UP" : "DOWN";
  const tone = dev > 0 ? "bg-green-500/15 text-green-700 border-green-500/30" : "bg-red-500/15 text-red-700 border-red-500/30";
  return <Badge variant="outline" className={`text-[10px] ${tone}`}>{side} bias +{Math.round(Math.abs(dev))}pp</Badge>;
}

export function TrendlineBreakStudyPanel() {
  const fn = useServerFn(getTrendlineBreakStudy);
  const { data, isLoading } = useQuery({
    queryKey: ["trendline-break-study", 14],
    queryFn: () => fn({ data: { days: 14 } }),
    refetchInterval: 5 * 60 * 1000,
  });

  const total = data?.rows.reduce((s, r) => s + r.n, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Trendline Break Study — BUY / SELL vs 15m close</span>
          {data && (
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString()} snapshots · last {data.days}d
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No matched snapshots yet. Study needs settled windows with spot ticks in the window.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 text-left">Bucket</th>
                    <th className="py-1.5 text-right">N</th>
                    <th className="py-1.5 text-right">% closed UP</th>
                    <th className="py-1.5 text-right">Avg channel width%</th>
                    <th className="py-1.5 text-right">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const meta = LABELS[r.bucket] ?? { title: r.bucket, hint: "" };
                    return (
                      <tr key={r.bucket} className="border-b last:border-b-0">
                        <td className="py-1.5">
                          <div className="font-medium">{meta.title}</div>
                          <div className="text-[10px] text-muted-foreground">{meta.hint}</div>
                        </td>
                        <td className="py-1.5 text-right">{r.n.toLocaleString()}</td>
                        <td className={`py-1.5 text-right ${pctUpTone(r.pct_up)}`}>
                          {r.pct_up == null ? "—" : `${r.pct_up.toFixed(1)}%`}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {r.avg_dist_pct == null ? "—" : `${r.avg_dist_pct}%`}
                        </td>
                        <td className="py-1.5 text-right">{edgeTag(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
              Read: when the <span className="font-medium">BUY (support)</span> line breaks, the % that still closed UP
              tells you whether the break is a false wick (reversion) or a real regime flip. Support that holds is your
              strongest UP signal; resistance that holds is your strongest DOWN signal.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
