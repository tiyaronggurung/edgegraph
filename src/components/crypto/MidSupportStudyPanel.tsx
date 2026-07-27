import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMidSupportStudy, type MidSupportRow } from "@/lib/midSupportStudy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const HINTS: Record<string, string> = {
  "T-600s": "Snapshot ~10 min before close",
  "T-300s": "Snapshot ~5 min before close",
  "T-120s": "Snapshot ~2 min before close",
  "T-30s":  "Final minute snapshot",
};

function tone(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 65) return "text-green-600 font-semibold";
  if (pct <= 45) return "text-red-600 font-semibold";
  return "text-muted-foreground";
}

function edgeTag(r: MidSupportRow) {
  if (r.edge_vs_baseline == null || r.n < 20) return null;
  const e = r.edge_vs_baseline;
  if (e >= 8)  return <Badge variant="outline" className="text-[10px] bg-green-500/15 text-green-700 border-green-500/30">MID pivot +{e.toFixed(0)}pp</Badge>;
  if (e <= -5) return <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-700 border-red-500/30">worse than baseline</Badge>;
  return <Badge variant="outline" className="text-[10px]">neutral</Badge>;
}

export function MidSupportStudyPanel() {
  const fn = useServerFn(getMidSupportStudy);
  const { data, isLoading } = useQuery({
    queryKey: ["mid-support-study", 14],
    queryFn: () => fn({ data: { days: 14 } }),
    refetchInterval: 5 * 60 * 1000,
  });

  const total = data?.rows.reduce((s, r) => s + r.n, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>MID Support Study — did (BUY+SELL)/2 hold vs Kalshi strike?</span>
          {data && (
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString()} windows · last {data.days}d
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No matched windows yet. Needs settled outcomes and trendline snapshots.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 text-left">When</th>
                    <th className="py-1.5 text-right">N</th>
                    <th className="py-1.5 text-right">Side-of-MID matches close</th>
                    <th className="py-1.5 text-right">Avg |spot − MID| %</th>
                    <th className="py-1.5 text-right">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.bucket} className="border-b last:border-b-0">
                      <td className="py-1.5">
                        <div className="font-medium">{r.bucket}</div>
                        <div className="text-[10px] text-muted-foreground">{HINTS[r.bucket] ?? ""}</div>
                      </td>
                      <td className="py-1.5 text-right">{r.n.toLocaleString()}</td>
                      <td className={`py-1.5 text-right ${tone(r.pct_up)}`}>
                        {r.pct_up == null ? "—" : `${r.pct_up.toFixed(1)}%`}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {r.avg_mid_dist_pct == null ? "—" : `${r.avg_mid_dist_pct}%`}
                      </td>
                      <td className="py-1.5 text-right">{edgeTag(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
              Read: if spot is above MID at time T and Kalshi settles YES (close &gt; strike), MID "held" as pivot.
              Higher % + positive Edge = MID acts as real support/resistance for the strike. Watch the last-minute
              bucket — that's where the pivot matters most.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
