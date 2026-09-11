// Real-money Kalshi P/L over time — Polymarket-style smooth curve with
// 1D / 1W / 1M / ALL ranges. Read-only: built from settled trades.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineChartIcon, RefreshCw } from "lucide-react";
import { opsGetKalshiPnlSeries } from "@/lib/opsManual/opsManual.functions";
import { cn } from "@/lib/utils";

type RangeKey = "1D" | "1W" | "1M" | "ALL";

const RANGES: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "1D", label: "1D", ms: 86_400_000 },
  { key: "1W", label: "1W", ms: 7 * 86_400_000 },
  { key: "1M", label: "1M", ms: 30 * 86_400_000 },
  { key: "ALL", label: "ALL", ms: null },
];

const usd = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function OpsKalshiPnlChart() {
  const fetchSeries = useServerFn(opsGetKalshiPnlSeries);
  const [range, setRange] = useState<RangeKey>("1W");

  const q = useQuery({
    queryKey: ["ops-kalshi-pnl-series"],
    queryFn: () => fetchSeries({}),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const all = q.data?.points ?? [];
  const currentBalance = q.data?.currentBalance ?? null;
  const startingBalance = q.data?.startingBalance ?? null;

  const view = useMemo(() => {
    const spec = RANGES.find((r) => r.key === range)!;
    const cutoff = spec.ms == null ? 0 : Date.now() - spec.ms;
    const inRange = all.filter((p) => Date.parse(p.t) >= cutoff);
    const before = all.filter((p) => Date.parse(p.t) < cutoff);
    const points = inRange.map((p) => ({ t: p.t, balance: p.balance, pnl: p.pnl }));
    const firstBalance = points[0]?.balance ?? startingBalance ?? 0;
    const lastBalance = points[points.length - 1]?.balance ?? currentBalance ?? 0;
    const wins = inRange.filter((p) => p.pnl > 0).length;
    const losses = inRange.filter((p) => p.pnl < 0).length;
    const periodPnl = Math.round((lastBalance - firstBalance) * 100) / 100;
    return {
      points,
      firstBalance,
      lastBalance,
      periodPnl,
      n: inRange.length,
      wins,
      losses,
    };
  }, [all, range, currentBalance, startingBalance]);

  const current = currentBalance ?? view.lastBalance;
  const start = startingBalance ?? view.firstBalance;
  const netChange = current != null && start != null ? Math.round((current - start) * 100) / 100 : null;
  const up = (netChange ?? 0) >= 0;
  const stroke = up ? "#34d399" : "#f87171";

  const fmtTick = (t: string) => {
    const d = new Date(t);
    return range === "1D"
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <section className="border border-border rounded-lg p-4 space-y-3 font-mono">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-[color:var(--color-primary)]" />
          <h2 className="text-sm font-bold uppercase tracking-widest">// Kalshi Balance — real money</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "px-2.5 py-1 text-[10px] uppercase tracking-widest",
                  range === r.key ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => q.refetch()}
            className="text-[10px] uppercase tracking-widest border border-border rounded px-2 py-1 hover:bg-muted flex items-center gap-1"
          >
            <RefreshCw className={cn("h-3 w-3", q.isFetching && "animate-spin")} /> Refresh
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="text-2xl font-bold text-foreground">{usd(current)}</div>
        {netChange != null && (
          <div className={cn("text-sm font-bold", up ? "text-emerald-400" : "text-red-400")}>
            {up ? "+" : ""}{usd(netChange)} in this range
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">
          {view.n} settled · {view.wins}W / {view.losses}L
          {startingBalance != null && <> · started {usd(startingBalance)}</>}
        </div>
      </div>

      {q.isLoading && <div className="text-xs text-muted-foreground">Loading trade history…</div>}
      {q.data && !q.data.connected && (
        <div className="text-xs text-red-400">{q.data.error ?? "Kalshi account not connected."}</div>
      )}
      {q.data?.connected && view.points.length === 0 && (
        <div className="text-xs text-muted-foreground">No settled trades in this range.</div>
      )}

      {view.points.length > 0 && (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={view.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="opsKalshiPnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.25} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={fmtTick}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                minTickGap={32}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                width={56}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelFormatter={(t) => new Date(t as string).toLocaleString()}
                formatter={(value: number, name) => [
                  usd(value),
                  name === "balance" ? "Total balance" : "Trade P/L",
                ]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={stroke}
                strokeWidth={2}
                fill="url(#opsKalshiPnlFill)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">
        Total balance money from settled Kalshi trades · current balance {currentBalance != null ? usd(currentBalance) : "—"} · updated{" "}
        {q.data ? new Date(q.data.fetchedAt).toLocaleTimeString() : "—"}
      </div>
    </section>
  );
}
