import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  getPaperBalance,
  getPaperFills,
  getPaperStats,
  resetPaperBalance,
  settleMyPaperFills,
} from "@/lib/paperTrading.functions";

export const Route = createFileRoute("/_authenticated/crypto/paper")({
  head: () => ({
    meta: [
      { title: "Paper Trading — BettingGraph" },
      { name: "description", content: "$100 paper bankroll and fill log for Model, PRED, and Green Hours bets." },
      { property: "og:title", content: "Paper Trading — BettingGraph" },
      { property: "og:description", content: "$100 paper bankroll and fill log for Model, PRED, and Green Hours bets." },
    ],
  }),
  component: PaperTradingPage,
});

const fmtUsd = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const fmtPct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);
const buttonLabel = { model: "Model", pred: "PRED", green_hours: "Green Hours" } as const;

function PaperTradingPage() {
  const balanceFn = useServerFn(getPaperBalance);
  const fillsFn = useServerFn(getPaperFills);
  const statsFn = useServerFn(getPaperStats);
  const resetFn = useServerFn(resetPaperBalance);
  const settleFn = useServerFn(settleMyPaperFills);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "model" | "pred" | "green_hours">("all");

  const balanceQ = useQuery({ queryKey: ["paperBalance"], queryFn: () => balanceFn(), refetchInterval: 15_000 });
  const fillsQ = useQuery({ queryKey: ["paperFills"], queryFn: () => fillsFn({ data: { limit: 200 } }), refetchInterval: 15_000 });
  const statsQ = useQuery({ queryKey: ["paperStats"], queryFn: () => statsFn(), refetchInterval: 15_000 });

  const resetM = useMutation({
    mutationFn: () => resetFn(),
    onSuccess: () => {
      toast.success("Paper balance reset to $100");
      qc.invalidateQueries({ queryKey: ["paperBalance"] });
      qc.invalidateQueries({ queryKey: ["paperFills"] });
      qc.invalidateQueries({ queryKey: ["paperStats"] });
    },
    onError: (e: any) => toast.error("Reset failed", { description: e?.message ?? String(e) }),
  });

  const settleM = useMutation({
    mutationFn: () => settleFn(),
    onSuccess: (r: any) => {
      if (r?.settled) toast.success(`Settled ${r.settled} paper fill${r.settled === 1 ? "" : "s"}`);
      else toast.info("No paper fills ready to settle");
      qc.invalidateQueries({ queryKey: ["paperBalance"] });
      qc.invalidateQueries({ queryKey: ["paperFills"] });
      qc.invalidateQueries({ queryKey: ["paperStats"] });
    },
    onError: (e: any) => toast.error("Settle failed", { description: e?.message ?? String(e) }),
  });

  const bal = balanceQ.data;
  const fills = fillsQ.data ?? [];
  const stats = statsQ.data;
  const filtered = filter === "all" ? fills : fills.filter(f => f.button === filter);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Paper Trading</h1>
          <p className="text-xs text-muted-foreground">$100 starting bankroll · $10 flat stake · manual reset only</p>
        </div>
        <Link to="/crypto" className="text-xs text-sky-400 hover:underline">← Back to Crypto</Link>
      </div>

      {/* Balance */}
      <div className="border border-border rounded-lg bg-card p-4">
        {bal ? (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-3xl font-bold">
                {fmtUsd(bal.balance_cents)}
                <span className="text-sm text-muted-foreground font-normal"> / {fmtUsd(bal.starting_cents)}</span>
              </div>
              <div className={`text-sm mt-0.5 ${bal.net_pnl_cents >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                Net {bal.net_pnl_cents >= 0 ? "+" : ""}{fmtUsd(bal.net_pnl_cents)}
              </div>
              {bal.bankrupt_at ? (
                <div className="mt-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 inline-block">
                  BANKRUPT — bets paused. Click Reset to refill.
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => settleM.mutate()}
                disabled={settleM.isPending}
                className="text-xs font-semibold px-3 py-1.5 rounded border border-border bg-muted/30 hover:bg-muted/50"
              >
                {settleM.isPending ? "Settling…" : "Settle Due"}
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Reset paper balance to $100 and void all open fills?")) resetM.mutate();
                }}
                disabled={resetM.isPending}
                className="text-xs font-semibold px-3 py-1.5 rounded border border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
              >
                {resetM.isPending ? "Resetting…" : "Reset to $100"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Loading balance…</div>
        )}
      </div>

      {/* Stats */}
      {stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Fires" value={String(stats.total.fires)} sub={`${stats.total.open} open`} />
          <StatCard label="Win Rate" value={fmtPct(stats.total.wins, stats.total.wins + stats.total.losses)} sub={`${stats.total.wins}W / ${stats.total.losses}L`} />
          <StatCard label="P&L" value={fmtUsd(stats.total.pnlCents)} sub="all buttons" tone={stats.total.pnlCents >= 0 ? "up" : "down"} />
          <StatCard label="Best Button" value={bestButton(stats)} sub="by P&L" />
          {(["model", "pred", "green_hours"] as const).map(b => (
            <StatCard
              key={b}
              label={buttonLabel[b]}
              value={fmtPct(stats.byButton[b].wins, stats.byButton[b].wins + stats.byButton[b].losses)}
              sub={`${stats.byButton[b].fires} fires · ${fmtUsd(stats.byButton[b].pnlCents)}`}
              tone={stats.byButton[b].pnlCents >= 0 ? "up" : "down"}
            />
          ))}
        </div>
      ) : null}

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "model", "pred", "green_hours"] as const).map(b => (
          <button
            key={b}
            onClick={() => setFilter(b)}
            className={`text-xs px-2.5 py-1 rounded border ${
              filter === b ? "border-sky-500/60 bg-sky-500/15 text-sky-300" : "border-border bg-muted/30 hover:bg-muted/50"
            }`}
          >
            {b === "all" ? "All" : buttonLabel[b]}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground self-center ml-auto">{filtered.length} fills</span>
      </div>

      {/* Fill log */}
      <div className="border border-border rounded-lg bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Fired</th>
              <th className="text-left px-3 py-2 font-medium">Close</th>
              <th className="text-left px-3 py-2 font-medium">Button</th>
              <th className="text-left px-3 py-2 font-medium">Ticker</th>
              <th className="text-left px-3 py-2 font-medium">Side</th>
              <th className="text-right px-3 py-2 font-medium">Contracts</th>
              <th className="text-right px-3 py-2 font-medium">Fill</th>
              <th className="text-right px-3 py-2 font-medium">Stake</th>
              <th className="text-right px-3 py-2 font-medium">Payout</th>
              <th className="text-right px-3 py-2 font-medium">P/L</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">No paper fills yet. Enable a Bet button on /crypto to start.</td></tr>
            ) : filtered.map(f => (
              <tr key={f.id} className="border-t border-border/50">
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(f.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(f.close_time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="px-3 py-1.5">{buttonLabel[f.button]}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{f.ticker}</td>
                <td className={`px-3 py-1.5 font-semibold ${f.side === "YES" ? "text-emerald-400" : "text-red-400"}`}>{f.side === "YES" ? "UP" : "DOWN"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{f.contracts}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{f.fill_price_cents}¢</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd(f.stake_cents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{f.payout_cents != null ? fmtUsd(f.payout_cents) : "—"}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${f.pnl_cents == null ? "text-muted-foreground" : f.pnl_cents >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {f.pnl_cents == null ? "—" : `${f.pnl_cents >= 0 ? "+" : ""}${fmtUsd(f.pnl_cents)}`}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${
                    f.status === "won" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" :
                    f.status === "lost" ? "border-red-500/50 bg-red-500/10 text-red-300" :
                    f.status === "void" ? "border-muted-foreground/40 bg-muted/30 text-muted-foreground" :
                    "border-sky-500/50 bg-sky-500/10 text-sky-300"
                  }`}>{f.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="border border-border rounded-lg bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : ""}`}>{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function bestButton(stats: import("@/lib/paperTrading.functions").PaperStats): string {
  const entries = Object.entries(stats.byButton) as Array<["model" | "pred" | "green_hours", { pnlCents: number; fires: number }]>;
  const withFires = entries.filter(([, v]) => v.fires > 0);
  if (!withFires.length) return "—";
  withFires.sort((a, b) => b[1].pnlCents - a[1].pnlCents);
  return buttonLabel[withFires[0][0]];
}
