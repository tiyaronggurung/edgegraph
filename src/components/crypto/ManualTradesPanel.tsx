import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncManualKalshiTrades, listManualKalshiTrades } from "@/lib/manualKalshiTrades.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, User, Bot } from "lucide-react";

export function ManualTradesPanel() {
  const sync = useServerFn(syncManualKalshiTrades);
  const list = useServerFn(listManualKalshiTrades);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["manualKalshiTrades"],
    queryFn: () => list(),
    refetchInterval: 30_000,
  });

  const syncMut = useMutation({
    mutationFn: () => sync({ data: { daysBack: 30 } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manualKalshiTrades"] }),
  });

  const s = data?.summary;
  const trades = data?.trades ?? [];

  const fmtPnl = (n: number | null | undefined) =>
    n == null ? "—" : `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
  const fmtPct = (n: number | null | undefined) =>
    n == null ? "—" : `${(n * 100).toFixed(1)}%`;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <h3 className="font-semibold">Manual Trades (Kalshi App)</h3>
          <Badge variant="outline" className="text-xs">Discipline mirror</Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
          Sync
        </Button>
      </div>

      {syncMut.data && !syncMut.data.ok && (
        <div className="text-xs text-destructive">{syncMut.data.error}</div>
      )}
      {syncMut.data && syncMut.data.ok && (
        <div className="text-xs text-muted-foreground">
          Fetched {syncMut.data.fetched} · Inserted {syncMut.data.inserted} · Bot fills skipped {syncMut.data.skippedBotFills} · Settled {syncMut.data.settled}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="p-2 border rounded">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <User className="h-3 w-3" /> You (manual)
            </div>
            <div className="text-lg font-semibold">{fmtPnl(s.totalPnl)}</div>
            <div className="text-xs text-muted-foreground">
              {s.wins}W / {s.losses}L · {fmtPct(s.winRate)}
            </div>
          </div>
          <div className="p-2 border rounded">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Bot className="h-3 w-3" /> Bot (last {s.botSampleSize})
            </div>
            <div className="text-lg font-semibold">{fmtPnl(s.botPnl)}</div>
            <div className="text-xs text-muted-foreground">
              win-rate {fmtPct(s.botWinRate)}
            </div>
          </div>
        </div>
      )}

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {!isLoading && trades.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No manual trades yet. Click Sync to pull the last 30 days from Kalshi.
        </div>
      )}
      {trades.length > 0 && (
        <div className="max-h-72 overflow-auto text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Time</th>
                <th>Ticker</th>
                <th>Side</th>
                <th>Act</th>
                <th className="text-right">Px</th>
                <th className="text-right">Qty</th>
                <th className="text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => (
                <tr key={t.id} className="border-t">
                  <td className="py-1">{new Date(t.filled_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="font-mono truncate max-w-[140px]" title={t.ticker}>{t.ticker}</td>
                  <td className={t.side === "yes" ? "text-emerald-500" : "text-red-500"}>{t.side.toUpperCase()}</td>
                  <td>{t.action}</td>
                  <td className="text-right">{t.price_cents}¢</td>
                  <td className="text-right">{t.contracts}</td>
                  <td className={`text-right ${t.pnl_usd == null ? "" : Number(t.pnl_usd) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {t.settled ? fmtPnl(Number(t.pnl_usd)) : "open"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
