import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getKalshiBookReport,
  type BookBucketRow,
  type LiveBookWindow,
} from "@/lib/kalshiBookReport.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const cash = (v: number | null | undefined) =>
  v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(2)}`;

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

function pnlTone(n: number | null | undefined) {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-green-600 font-semibold" : n < 0 ? "text-red-600 font-semibold" : "";
}

function LiveWindowCard({ live }: { live: LiveBookWindow }) {
  const mmss = `${Math.floor(live.seconds_to_close / 60)}:${String(live.seconds_to_close % 60).padStart(2, "0")}`;
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <span className="font-mono">{live.ticker}</span>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className="bg-primary/10 border-primary/40">
            LIVE · min {live.minute_of_15}/15
          </Badge>
          <span className="tabular-nums text-muted-foreground">{mmss} left</span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-border/60 overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${live.pct_elapsed}%` }} />
      </div>
      {(() => {
        const yAvg = live.yes_avg_cents ?? null;
        const nAvg = live.no_avg_cents ?? null;
        const yCost = live.yes_cost ?? null;
        const nCost = live.no_cost ?? null;
        const yPay = live.yes_payout ?? null;
        const nPay = live.no_payout ?? null;
        const coll = live.total_collected ?? null;
        const hY = live.house_if_yes ?? null;
        const hN = live.house_if_no ?? null;
        const lean = live.house_lean ?? null;
        const has = (yCost ?? 0) + (nCost ?? 0) > 0;
        if (!has) return <div className="text-[11px] text-muted-foreground">accumulating…</div>;
        return (
          <div
            className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] border-t border-border/50 pt-1"
            title={
              `Window-to-date taker cost basis (real Kalshi prints):\n` +
              `  UP  (YES): ${yPay ?? "—"} contracts @ avg ${yAvg != null ? yAvg.toFixed(1) + "¢" : "—"} = ${cash(yCost)} paid\n` +
              `  DOWN (NO): ${nPay ?? "—"} contracts @ avg ${nAvg != null ? nAvg.toFixed(1) + "¢" : "—"} = ${cash(nCost)} paid\n` +
              `  Collected by the book: ${cash(coll)}\n` +
              `  Payout owed if UP wins:   ${cash(yPay)}  → book P/L ${cash(hY)}\n` +
              `  Payout owed if DOWN wins: ${cash(nPay)}  → book P/L ${cash(hN)}`
            }
          >
            <span className="text-muted-foreground tracking-wider">COST 15m</span>
            <span className="flex items-center gap-1">
              <span className="text-green-600/80">UP avg</span>
              <span className="tabular-nums font-bold text-green-600">
                {yAvg != null ? `${yAvg.toFixed(1)}¢` : "—"}
              </span>
              <span className="text-muted-foreground">({cash(yCost)})</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1">
              <span className="text-red-600/80">DN avg</span>
              <span className="tabular-nums font-bold text-red-600">
                {nAvg != null ? `${nAvg.toFixed(1)}¢` : "—"}
              </span>
              <span className="text-muted-foreground">({cash(nCost)})</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">
              pool <span className="tabular-nums text-foreground">{cash(coll)}</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">
              payout <span className="tabular-nums text-green-600">{cash(yPay)}</span>
              <span className="text-muted-foreground/40"> / </span>
              <span className="tabular-nums text-red-600">{cash(nPay)}</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">
              book P/L{" "}
              <span className={`tabular-nums ${(hY ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{cash(hY)}</span>
              <span className="text-muted-foreground/40"> / </span>
              <span className={`tabular-nums ${(hN ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{cash(hN)}</span>
            </span>
            {lean && (
              <Badge variant="outline" className="text-[10px] py-0">
                book leans {lean === "YES" ? "↑ UP" : "↓ DOWN"}
              </Badge>
            )}
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground tabular-nums">
              vol {live.yes_vol == null ? "—" : Math.round(live.yes_vol).toLocaleString()} /{" "}
              {live.no_vol == null ? "—" : Math.round(live.no_vol).toLocaleString()}
              {live.stale_seconds != null && ` · last print ${live.stale_seconds}s ago`}
            </span>
          </div>
        );
      })()}
    </div>
  );
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
    refetchInterval: 15_000,
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

            {data!.live && <LiveWindowCard live={data!.live} />}

            <BucketTable title="Per week" rows={data!.perWeek} />
            <BucketTable title="Per day" rows={data!.perDay} />
            <BucketTable title="Per hour (last 24)" rows={data!.perHour} />

            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Every 15m window — end P/L log ({data!.recent.length})
              </div>
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
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
