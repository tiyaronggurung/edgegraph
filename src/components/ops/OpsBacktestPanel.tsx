import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { opsRunBacktest } from "@/lib/opsManual/opsManual.functions";
import type { BacktestOutput, PeriodMetrics, BucketStat } from "./backtestTypes";
import type { OpsDashboard } from "./types";
import { cn } from "@/lib/utils";

const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;
const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const one = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);

const FAIL_LABEL: Record<string, string> = {
  t7_lock: "No T7 study lock",
  study_conf: "Confidence below 90%",
  cushion: "Cushion below $40",
  ask_price: "Ask above 70¢",
  model_agreement: "Model disagreed with study",
  time_left: "Under two minutes left",
  hour_allowed: "Excluded UTC hour",
  lock_fresh: "Fired too long after the lock",
  our_odds_confirm: "Our odds below 83.3% on the study side",
};

function BucketTable({ title, rows }: { title: string; rows: BucketStat[] }) {
  const shown = rows.filter((r) => r.n > 0);
  return (
    <div className="border border-border rounded p-3">
      <div className="terminal-label mb-2">// {title}</div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No qualifying bets in this breakdown.</p>
      ) : (
        <table className="w-full text-[11px] font-mono">
          <thead className="text-muted-foreground uppercase tracking-wider">
            <tr className="border-b border-border">
              <th className="text-left py-1">Bucket</th>
              <th className="text-right py-1">N</th>
              <th className="text-right py-1">Wins</th>
              <th className="text-right py-1">Win rate</th>
              <th className="text-right py-1">P/L</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b border-border/40">
                <td className="py-1">{r.key}</td>
                <td className="py-1 text-right">{r.n}</td>
                <td className="py-1 text-right">{r.wins}</td>
                <td className={cn("py-1 text-right", (r.winRate ?? 0) >= 0.88 ? "text-emerald-400" : (r.winRate ?? 1) < 0.78 ? "text-red-400" : "")}>{pct(r.winRate)}</td>
                <td className={cn("py-1 text-right", r.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>{usd(r.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MetricsRow({ label, m }: { label: string; m: PeriodMetrics }) {
  return (
    <tr className="border-b border-border/40">
      <td className="py-1 pr-3 whitespace-nowrap">{label}</td>
      <td className="py-1 pr-3 text-right">{m.qualifyingWindows}</td>
      <td className="py-1 pr-3 text-right">{m.betsTaken}</td>
      <td className="py-1 pr-3 text-right">{m.wins}</td>
      <td className="py-1 pr-3 text-right">{m.losses}</td>
      <td className={cn("py-1 pr-3 text-right", (m.winRate ?? 0) >= 0.88 ? "text-emerald-400" : (m.winRate ?? 1) < 0.78 ? "text-red-400" : "")}>{pct(m.winRate)}</td>
      <td className={cn("py-1 pr-3 text-right", m.netPnl >= 0 ? "text-emerald-400" : "text-red-400")}>{usd(m.netPnl)}</td>
      <td className="py-1 pr-3 text-right">{pct(m.returnOnStake)}</td>
      <td className="py-1 pr-3 text-right">{one(m.avgAsk)}¢</td>
      <td className="py-1 pr-3 text-right">{one(m.avgConfidence)}%</td>
      <td className="py-1 pr-3 text-right">${one(m.avgCushion)}</td>
      <td className="py-1 pr-3 text-right">{usd(m.avgProfitPerBet)}</td>
      <td className="py-1 pr-3 text-right">{m.maxConsecutiveLosses}</td>
      <td className="py-1 pr-3 text-right">{usd(m.maxDrawdown)}</td>
      <td className="py-1 pr-3 text-right">{m.profitFactor == null ? "—" : m.profitFactor.toFixed(2)}</td>
      <td className="py-1 pr-3 text-right">{usd(m.evPerBet)}</td>
      <td className="py-1 pr-3 text-right">{pct(m.studyOnlyAccuracy)}</td>
      <td className="py-1 pr-3 text-right">{pct(m.modelOnlyAccuracy)}</td>
      <td className="py-1 pr-3 text-right">{pct(m.agreementAccuracy)}</td>
    </tr>
  );
}

export function OpsBacktestPanel({ dash }: { dash: OpsDashboard }) {
  const run = useServerFn(opsRunBacktest);
  const [busy, setBusy] = useState(false);
  const stored = (dash.lastBacktest as { results?: BacktestOutput; run_at?: string } | null)?.results ?? null;
  const [bt, setBt] = useState<BacktestOutput | null>(stored);

  const doRun = async () => {
    setBusy(true);
    try {
      const r = await run({});
      setBt(r.backtest as unknown as BacktestOutput);
      toast.success("Backtest complete");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="terminal-label">
          // Routine backtest — decision-time reconstruction only, no lookahead
        </div>
        <button
          onClick={doRun}
          disabled={busy}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
        >
          {busy ? "Running…" : "Run backtest now"}
        </button>
      </div>

      {!bt ? (
        <p className="text-xs text-muted-foreground">
          No backtest run yet. Runs automatically each day at 00:10 UTC, or trigger one above.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Run at {new Date(bt.runAt).toLocaleString()} · {bt.totalWindows} windows scanned ·{" "}
            {bt.qualifiedWindows} qualified ({pct(bt.qualifiedWindows / Math.max(1, bt.totalWindows))} of all
            windows) · Status <b className="text-foreground">{bt.status.replace("_", " ")}</b> — {bt.statusReason}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-muted-foreground uppercase tracking-wider">
                <tr className="border-b border-border">
                  {["Period", "Qual windows", "Bets", "Wins", "Losses", "WR", "Net P/L", "ROS", "Avg ask", "Avg conf", "Avg cushion", "Avg profit", "Max L-streak", "Max DD", "Profit factor", "EV/bet", "Study acc", "Model acc", "Agreement acc"].map((h) => (
                    <th key={h} className="py-1 pr-3 text-right first:text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bt.periods.map((p) => <MetricsRow key={p.label} label={p.label} m={p.metrics} />)}
                <MetricsRow label="Preferred hours only" m={bt.preferredHours} />
              </tbody>
            </table>
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <BucketTable title="By UTC hour" rows={bt.periods[4]?.metrics.byHour ?? []} />
            <BucketTable title="By cushion bucket" rows={bt.periods[4]?.metrics.byCushion ?? []} />
            <BucketTable title="By confidence bucket" rows={bt.periods[4]?.metrics.byConfidence ?? []} />
            <BucketTable title="By entry-price bucket" rows={bt.periods[4]?.metrics.byAsk ?? []} />
          </div>

          <div className="border border-border rounded p-3">
            <div className="terminal-label mb-2">// Why windows were rejected</div>
            <div className="flex flex-wrap gap-2">
              {bt.failReasonTally.map((f) => (
                <span key={f.reason} className="text-[11px] border border-border rounded px-2 py-1">
                  {FAIL_LABEL[f.reason] ?? f.reason}: <b>{f.n}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="border border-border rounded p-3 overflow-x-auto">
            <div className="terminal-label mb-2">// Recent reconstructed windows (last 120)</div>
            <table className="w-full text-[11px] font-mono">
              <thead className="text-muted-foreground uppercase tracking-wider">
                <tr className="border-b border-border">
                  {["Close", "UTC", "Qualified", "Study", "Conf", "Model", "Cushion", "Ask", "Secs", "Outcome", "P/L @ $100", "Reject reasons"].map((h) => (
                    <th key={h} className="text-left py-1 pr-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bt.recentWindows.map((w) => (
                  <tr key={w.ticker} className="border-b border-border/40">
                    <td className="py-1 pr-3 whitespace-nowrap">{new Date(w.closeTime).toISOString().slice(5, 16).replace("T", " ")}</td>
                    <td className="py-1 pr-3">{String(w.utcHour).padStart(2, "0")}</td>
                    <td className={cn("py-1 pr-3", w.qualified ? "text-emerald-400" : "text-muted-foreground")}>{w.qualified ? "YES" : "no"}</td>
                    <td className="py-1 pr-3">{w.studySide ?? "—"}</td>
                    <td className="py-1 pr-3">{one(w.studyConf)}</td>
                    <td className="py-1 pr-3">{w.modelSide ?? "—"}</td>
                    <td className="py-1 pr-3">{w.cushionUsd == null ? "—" : `$${w.cushionUsd.toFixed(0)}`}</td>
                    <td className="py-1 pr-3">{w.askCents == null ? "—" : `${w.askCents}¢`}</td>
                    <td className="py-1 pr-3">{w.secondsLeft ?? "—"}</td>
                    <td className="py-1 pr-3">{w.outcome ?? "open"}</td>
                    <td className={cn("py-1 pr-3", (w.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>{w.qualified ? usd(w.pnl) : "—"}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{w.failReasons.map((r) => FAIL_LABEL[r] ?? r).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
