import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
      { name: "description", content: "$100 paper bankroll with per-button fill logs for Model, PRED, and Green Hours bets." },
      { property: "og:title", content: "Paper Trading — BettingGraph" },
      { property: "og:description", content: "$100 paper bankroll with per-button fill logs for Model, PRED, and Green Hours bets." },
    ],
  }),
  component: PaperTradingPage,
});

type ButtonKind = "model" | "pred" | "green_hours";
type PaperFillRow = import("@/lib/paperTrading.functions").PaperFillRow;
const BUTTON_ORDER: ButtonKind[] = ["model", "pred", "green_hours"];
const buttonLabel: Record<ButtonKind, string> = { model: "Model", pred: "PRED", green_hours: "Green Hours" };
const buttonTint: Record<ButtonKind, string> = {
  model: "border-sky-500/40 bg-sky-500/10",
  pred: "border-fuchsia-500/40 bg-fuchsia-500/10",
  green_hours: "border-emerald-500/40 bg-emerald-500/10",
};

const fmtUsd = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const fmtPct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);
const fmtDateKey = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
};

function PaperTradingPage() {
  const balanceFn = useServerFn(getPaperBalance);
  const fillsFn = useServerFn(getPaperFills);
  const statsFn = useServerFn(getPaperStats);
  const resetFn = useServerFn(resetPaperBalance);
  const settleFn = useServerFn(settleMyPaperFills);
  const qc = useQueryClient();

  const balanceQ = useQuery({ queryKey: ["paperBalance"], queryFn: () => balanceFn(), refetchInterval: 15_000 });
  const fillsQ = useQuery({ queryKey: ["paperFills"], queryFn: () => fillsFn({ data: { limit: 500 } }), refetchInterval: 15_000 });
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

  // Group fills by button
  const byButton = useMemo(() => {
    const g: Record<ButtonKind, PaperFillRow[]> = { model: [], pred: [], green_hours: [] };
    for (const f of fills) if (g[f.button]) g[f.button].push(f);
    return g;
  }, [fills]);

  // Daily P/L breakdown (settled fills only) across all buttons
  const dailyPnl = useMemo(() => {
    const map = new Map<string, { key: string; day: string; sortKey: number; pnlCents: number; wins: number; losses: number; fires: number; byBtn: Record<ButtonKind, number> }>();
    for (const f of fills) {
      const key = new Date(f.created_at).toISOString().slice(0, 10);
      const day = fmtDateKey(f.created_at);
      const cur = map.get(key) ?? {
        key, day, sortKey: new Date(key).getTime(),
        pnlCents: 0, wins: 0, losses: 0, fires: 0,
        byBtn: { model: 0, pred: 0, green_hours: 0 },
      };
      cur.fires += 1;
      if (f.status === "won") cur.wins += 1;
      if (f.status === "lost") cur.losses += 1;
      cur.pnlCents += f.pnl_cents ?? 0;
      cur.byBtn[f.button] += f.pnl_cents ?? 0;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.sortKey - a.sortKey);
  }, [fills]);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Paper Trading</h1>
          <p className="text-xs text-muted-foreground">$100 starting bankroll · $10 flat stake · auto-fires all 3 strategies · no real money</p>
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
          {BUTTON_ORDER.map(b => (
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

      {/* Daily P/L breakdown */}
      <div className="border border-border rounded-lg bg-card">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">Daily P&amp;L</div>
          <div className="text-[11px] text-muted-foreground">settled fills · grouped by day</div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {dailyPnl.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">No fills yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Day</th>
                  <th className="text-right px-3 py-2 font-medium">Fires</th>
                  <th className="text-right px-3 py-2 font-medium">W/L</th>
                  <th className="text-right px-3 py-2 font-medium">Model</th>
                  <th className="text-right px-3 py-2 font-medium">PRED</th>
                  <th className="text-right px-3 py-2 font-medium">Green</th>
                  <th className="text-right px-3 py-2 font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {dailyPnl.map(d => (
                  <tr key={d.key} className="border-t border-border/50">
                    <td className="px-3 py-1.5">{d.day}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{d.fires}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{d.wins}W / {d.losses}L</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${d.byBtn.model >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtUsd(d.byBtn.model)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${d.byBtn.pred >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtUsd(d.byBtn.pred)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${d.byBtn.green_hours >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtUsd(d.byBtn.green_hours)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${d.pnlCents >= 0 ? "text-emerald-400" : "text-red-400"}`}>{d.pnlCents >= 0 ? "+" : ""}{fmtUsd(d.pnlCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Three scrollable per-button fill logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {BUTTON_ORDER.map(b => (
          <ButtonLogPanel key={b} button={b} rows={byButton[b]} tint={buttonTint[b]} />
        ))}
      </div>
    </div>
  );
}

function ButtonLogPanel({ button, rows, tint }: { button: ButtonKind; rows: PaperFillRow[]; tint: string }) {
  const totals = useMemo(() => {
    let wins = 0, losses = 0, pnl = 0, open = 0;
    for (const r of rows) {
      if (r.status === "won") wins += 1;
      else if (r.status === "lost") losses += 1;
      else if (r.status === "open") open += 1;
      pnl += r.pnl_cents ?? 0;
    }
    return { wins, losses, pnl, open, fires: rows.length };
  }, [rows]);

  return (
    <div className={`border rounded-lg bg-card ${tint}`}>
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{buttonLabel[button]}</div>
          <div className="text-[10px] text-muted-foreground">{totals.fires} fires · {totals.wins}W / {totals.losses}L · {totals.open} open</div>
        </div>
        <div className={`text-sm font-mono tabular-nums font-semibold ${totals.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {totals.pnl >= 0 ? "+" : ""}{fmtUsd(totals.pnl)}
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">Waiting for first fire…</div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="bg-muted/30 text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Time</th>
                <th className="text-left px-2 py-1.5 font-medium">Side</th>
                <th className="text-right px-2 py-1.5 font-medium">Fill</th>
                <th className="text-right px-2 py-1.5 font-medium">P/L</th>
                <th className="text-left px-2 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.id} className="border-t border-border/40">
                  <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">
                    {new Date(f.created_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className={`px-2 py-1 font-semibold ${f.side === "YES" ? "text-emerald-400" : "text-red-400"}`}>
                    {f.side === "YES" ? "UP" : "DOWN"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.fill_price_cents}¢</td>
                  <td className={`px-2 py-1 text-right tabular-nums font-semibold ${f.pnl_cents == null ? "text-muted-foreground" : f.pnl_cents >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {f.pnl_cents == null ? "—" : `${f.pnl_cents >= 0 ? "+" : ""}${fmtUsd(f.pnl_cents)}`}
                  </td>
                  <td className="px-2 py-1">
                    <span className={`inline-block text-[9px] px-1 py-0.5 rounded border ${
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
        )}
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
  const entries = Object.entries(stats.byButton) as Array<[ButtonKind, { pnlCents: number; fires: number }]>;
  const withFires = entries.filter(([, v]) => v.fires > 0);
  if (!withFires.length) return "—";
  withFires.sort((a, b) => b[1].pnlCents - a[1].pnlCents);
  return buttonLabel[withFires[0][0]];
}
