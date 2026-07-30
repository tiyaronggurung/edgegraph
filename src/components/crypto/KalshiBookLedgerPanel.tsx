import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getKalshiBookReport,
  type BookBucketRow,
} from "@/lib/kalshiBookReport.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

function pnlTone(n: number | null | undefined) {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-green-600 font-semibold" : n < 0 ? "text-red-600 font-semibold" : "";
}

function BucketTable({ title, rows }: { title: string; rows: BookBucketRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-2 font-normal">bucket</th>
              <th className="py-1 pr-2 font-normal text-right">win</th>
              <th className="py-1 pr-2 font-normal text-right">contracts</th>
              <th className="py-1 pr-2 font-normal text-right">collected</th>
              <th className="py-1 pr-2 font-normal text-right">paid out</th>
              <th className="py-1 font-normal text-right">book P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bucket} className="border-t border-border/40">
                <td className="py-1 pr-2 font-mono">{r.bucket}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {r.windows}
                  {r.book_win_rate != null && (
                    <span className="text-muted-foreground"> · {r.book_win_rate}%</span>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.contracts.toLocaleString()}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(r.collected)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(r.paid_out)}</td>
                <td className={`py-1 text-right tabular-nums ${pnlTone(r.house_pnl)}`}>
                  {money(r.house_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function KalshiBookLedgerPanel() {
  const [days, setDays] = useState(7);
  const fn = useServerFn(getKalshiBookReport);
  const { data, isLoading } = useQuery({
    queryKey: ["kalshi-book-report", days],
    queryFn: () => fn({ data: { days } }),
    refetchInterval: 60_000,
  });

  const t = data?.totals;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm">Kalshi Book Ledger — cost, volume & house P/L</CardTitle>
          <div className="flex gap-1">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  days === d ? "bg-primary/10 border-primary/40" : "border-border/60 text-muted-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && t && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{t.windows} windows logged</Badge>
              <Badge variant="outline">{t.contracts.toLocaleString()} contracts</Badge>
              <Badge variant="outline">collected {money(t.collected)}</Badge>
              <Badge variant="outline">paid out {money(t.paid_out)}</Badge>
              <Badge
                variant="outline"
                className={
                  (t.house_pnl ?? 0) >= 0
                    ? "bg-green-500/15 text-green-700 border-green-500/30"
                    : "bg-red-500/15 text-red-700 border-red-500/30"
                }
              >
                book {money(t.house_pnl)}
              </Badge>
              {t.book_win_rate != null && (
                <Badge variant="outline">book wins {t.book_win_rate}% of windows</Badge>
              )}
            </div>

            <BucketTable title="Per week" rows={data!.perWeek} />
            <BucketTable title="Per day" rows={data!.perDay} />
            <BucketTable title="Per hour (last 24)" rows={data!.perHour} />

            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Last 15m windows
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-2 font-normal">window</th>
                      <th className="py-1 pr-2 font-normal text-right">UP vol / avg</th>
                      <th className="py-1 pr-2 font-normal text-right">DOWN vol / avg</th>
                      <th className="py-1 pr-2 font-normal text-right">collected</th>
                      <th className="py-1 pr-2 font-normal text-right">lean</th>
                      <th className="py-1 pr-2 font-normal text-right">result</th>
                      <th className="py-1 font-normal text-right">book P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.recent.map((r) => (
                      <tr key={r.ticker} className="border-t border-border/40">
                        <td className="py-1 pr-2 font-mono">
                          {new Date(r.window_start).toISOString().slice(5, 16).replace("T", " ")}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {r.yes_vol == null ? "—" : Math.round(r.yes_vol).toLocaleString()}
                          <span className="text-muted-foreground">
                            {r.yes_avg_cents == null ? "" : ` @ ${r.yes_avg_cents}¢`}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {r.no_vol == null ? "—" : Math.round(r.no_vol).toLocaleString()}
                          <span className="text-muted-foreground">
                            {r.no_avg_cents == null ? "" : ` @ ${r.no_avg_cents}¢`}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{money(r.total_collected)}</td>
                        <td className="py-1 pr-2 text-right">
                          {r.house_lean === "YES" ? "↑" : r.house_lean === "NO" ? "↓" : "—"}
                        </td>
                        <td className="py-1 pr-2 text-right">
                          {r.outcome === "YES" ? "UP" : r.outcome === "NO" ? "DOWN" : "—"}
                        </td>
                        <td className={`py-1 text-right tabular-nums ${pnlTone(r.house_pnl)}`}>
                          {money(r.house_pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Logged every minute from live Kalshi prints. Collected = taker dollars paid in;
              paid out = $1 × winning-side contracts. Book P/L is only counted once a window settles.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
