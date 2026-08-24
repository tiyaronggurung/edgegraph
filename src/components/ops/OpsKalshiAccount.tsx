import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Wallet } from "lucide-react";
import { opsGetKalshiAccount } from "@/lib/opsManual/opsManual.functions";
import { OpsGoalMeter } from "./OpsGoalMeter";

import { cn } from "@/lib/utils";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold", tone)}>{value}</div>
    </div>
  );
}

export function OpsKalshiAccount({ onBankroll }: { onBankroll?: (v: number) => void }) {
  const fetchAcct = useServerFn(opsGetKalshiAccount);
  const q = useQuery({
    queryKey: ["ops-kalshi-account"],
    queryFn: () => fetchAcct({}),
    refetchInterval: 60_000,
  });

  const a = q.data;
  const tone = (n: number | null | undefined) =>
    n == null ? "" : n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "";

  return (
    <div className="border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="terminal-label flex items-center gap-2">
          <Wallet className="h-3.5 w-3.5" />
          // Live Kalshi Account — real money
        </div>
        <button
          onClick={() => q.refetch()}
          className="text-[10px] uppercase tracking-widest border border-border rounded px-2 py-1 hover:bg-muted flex items-center gap-1"
        >
          <RefreshCw className={cn("h-3 w-3", q.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>

      {q.isLoading && <div className="text-xs text-muted-foreground">Reading Kalshi account…</div>}
      {q.error && <div className="text-xs text-red-400">{(q.error as Error).message}</div>}
      {a && !a.connected && (
        <div className="text-xs text-red-400">
          Not connected: {a.error ?? "unknown error"} — save your Kalshi API Key ID and Private Key on the Crypto page first.
        </div>
      )}

      {a?.connected && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Cash Balance" value={usd(a.balance)} tone="text-[color:var(--color-primary)]" />
            <Stat label="Portfolio Value" value={usd(a.payout ?? a.openExposure)} />
            <Stat label="Realized P/L (30d)" value={usd(a.totals.pnl)} tone={tone(a.totals.pnl)} />
            <Stat label="Today P/L" value={usd(a.today.pnl)} tone={tone(a.today.pnl)} />
            <Stat label="Settled (30d)" value={`${a.totals.n} · ${a.totals.wins}W / ${a.totals.losses}L`} />
            <Stat label="Win Rate" value={pct(a.totals.winRate)} />
            <Stat label="ROI on Turnover" value={pct(a.totals.roi)} tone={tone(a.totals.roi)} />
            <Stat
              label="BTC 15m Only"
              value={`${usd(a.btcOnly.pnl)} · ${pct(a.btcOnly.winRate)} (${a.btcOnly.n})`}
              tone={tone(a.btcOnly.pnl)}
            />
          </div>

          <OpsGoalMeter balance={a.balance} />


          {onBankroll && a.balance != null && (
            <button
              onClick={() => onBankroll(a.balance as number)}
              className="text-[10px] uppercase tracking-widest border border-border rounded px-2 py-1 hover:bg-muted"
            >
              Use live balance as today&apos;s bankroll
            </button>
          )}

          {a.openPositions.length > 0 && (
            <div>
              <div className="terminal-label mb-1">// Open positions</div>
              <div className="space-y-1">
                {a.openPositions.map((p) => (
                  <div key={p.ticker} className="flex justify-between text-[11px] border border-border rounded px-2 py-1">
                    <span className="truncate">{p.ticker}</span>
                    <span className="text-muted-foreground">
                      {p.position > 0 ? "YES" : "NO"} ×{Math.abs(p.position)} · exposure {usd(p.exposure)}
                      {p.restingOrders > 0 ? ` · ${p.restingOrders} resting` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="terminal-label mb-1">// Settled fills (real, newest first)</div>
            <div className="max-h-72 overflow-auto space-y-1">
              {a.settlements.length === 0 && (
                <div className="text-xs text-muted-foreground">No settlements in the last 30 days.</div>
              )}
              {a.settlements.map((s, i) => (
                <div
                  key={`${s.ticker}-${s.settledAt}-${i}`}
                  className="flex items-center justify-between gap-2 text-[11px] border border-border rounded px-2 py-1"
                >
                  <span className="truncate flex-1">{s.ticker}</span>
                  <span className="text-muted-foreground w-28 shrink-0">
                    {s.settledAt ? new Date(s.settledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                  <span className="text-muted-foreground w-24 shrink-0">
                    {(s.side ?? "—").toUpperCase()} ×{s.contracts}
                  </span>
                  <span className="text-muted-foreground w-20 shrink-0 text-right">cost {usd(s.cost)}</span>
                  <span className={cn("w-20 shrink-0 text-right font-bold", tone(s.pnl))}>{usd(s.pnl)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground">
            Read-only view signed with your Kalshi API key · updated {new Date(a.fetchedAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}
