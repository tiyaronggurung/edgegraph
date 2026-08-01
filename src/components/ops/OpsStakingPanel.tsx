import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { opsOpenDay, opsLogTrade, opsSettleTrade } from "@/lib/opsManual/opsManual.functions";
import type { OpsDashboard, OpsTradeRow } from "./types";
import { cn } from "@/lib/utils";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold", tone)}>{value}</div>
    </div>
  );
}

export function OpsStakingPanel({ dash, onRefresh }: { dash: OpsDashboard; onRefresh: () => void }) {
  const openDay = useServerFn(opsOpenDay);
  const logTrade = useServerFn(opsLogTrade);
  const settle = useServerFn(opsSettleTrade);

  const [bankInput, setBankInput] = useState(String(dash.morningBankroll || 1000));
  const [busy, setBusy] = useState(false);
  const [depth, setDepth] = useState("");

  const [form, setForm] = useState({
    ticker: "",
    strike: "",
    studySide: "YES",
    studyConf: "",
    modelSide: "YES",
    modelConf: "",
    spot: "",
    ask: "",
    secondsLeft: "",
    notes: "",
  });

  const disabled = dash.staking.mode === "disabled" || dash.stops.stopped;

  const doOpen = async () => {
    setBusy(true);
    try {
      const r = await openDay({ data: { morningBankroll: Number(bankInput) } });
      if (!r.ok) throw new Error(r.error);
      toast.success(`Day opened — unit ${usd(r.staking.unitUsd)}`);
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const doLog = async () => {
    if (!form.ticker.trim()) return toast.error("Ticker required");
    setBusy(true);
    try {
      const spot = num(form.spot);
      const strike = num(form.strike);
      const r = await logTrade({
        data: {
          ticker: form.ticker.trim(),
          strike,
          side: form.studySide,
          studySide: form.studySide,
          studyConf: num(form.studyConf),
          modelSide: form.modelSide,
          modelConf: num(form.modelConf),
          spotAtLock: spot,
          cushionUsd: spot != null && strike != null ? Math.abs(spot - strike) : null,
          askCents: num(form.ask),
          secondsLeft: num(form.secondsLeft),
          stake: dash.staking.unitUsd,
          notes: form.notes || null,
        },
      });
      if (!r.ok) throw new Error(r.error);
      if (r.violations.length) toast.warning(`Logged with violations: ${r.violations.join(", ")}`);
      else toast.success("Trade logged — fully compliant");
      setForm({ ...form, ticker: "", notes: "" });
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doSettle = async (t: OpsTradeRow, result: "win" | "loss") => {
    const pnl = result === "win" ? (t.potential_profit ?? 0) : -t.stake;
    setBusy(true);
    try {
      const r = await settle({ data: { id: t.id, result, realizedPnl: pnl } });
      if (!r.ok) throw new Error(r.error);
      toast.success(`Settled ${result} — ${usd(pnl)}`);
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const depthUsd = depth.trim() === "" ? null : Number(depth);
  const depthApplies = dash.summary.currentBankroll >= dash.rules.DEPTH_BANKROLL_THRESHOLD_USD;
  const depthFrac =
    depthUsd && depthUsd > 0 ? (dash.staking.unitUsd / depthUsd) * 100 : null;

  const openTrades = (dash.trades as OpsTradeRow[]).filter(
    (t) => !t.result && t.session_date === dash.sessionDate,
  );

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4">
      <div className="terminal-label">// Staking mode — fixed at day open, never recalculated</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Stat label="Morning bankroll" value={usd(dash.morningBankroll)} />
        <Stat label="Active unit" value={`${(dash.staking.unitPct * 100).toFixed(0)}%`} />
        <Stat label="Stake per trade" value={usd(dash.staking.unitUsd)} />
        <Stat label="Bets remaining" value={String(dash.stops.betsRemaining)} />
        <Stat
          label="Consecutive losses"
          value={String(dash.consecutiveLosses)}
          tone={dash.consecutiveLosses >= 2 ? "text-red-400" : undefined}
        />
        <Stat
          label="Daily P/L"
          value={usd(dash.dailyPnl)}
          tone={dash.dailyPnl >= 0 ? "text-emerald-400" : "text-red-400"}
        />
        <Stat label="To profit stop" value={usd(dash.stops.distanceToProfitStopUsd)} />
        <Stat label="To loss stop" value={usd(dash.stops.distanceToLossStopUsd)} />
        <Stat
          label="Staking mode"
          value={dash.staking.mode.replace("_", " ").toUpperCase()}
          tone={dash.staking.mode === "disabled" ? "text-red-400" : dash.staking.mode === "risk_reduced" ? "text-orange-400" : "text-emerald-400"}
        />
        <Stat label="Session" value={dash.stops.stopped ? "STOPPED" : "OPEN"} tone={dash.stops.stopped ? "text-red-400" : "text-emerald-400"} />
      </div>

      <p className="text-xs text-muted-foreground">
        <b className="text-foreground">Mode reason:</b> {dash.staking.reason}
        {dash.stops.reason && (
          <> · <b className="text-red-400">Stop:</b> {dash.stops.reason}</>
        )}
      </p>

      {/* Day open */}
      <div className="border border-border rounded p-3 space-y-2">
        <div className="terminal-label">// Open trading day</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={bankInput}
            onChange={(e) => setBankInput(e.target.value)}
            inputMode="decimal"
            className="w-36 bg-background border border-border rounded px-2 py-1 text-xs"
            placeholder="Morning bankroll"
          />
          <button
            onClick={doOpen}
            disabled={busy}
            className="text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
          >
            {dash.dayOpened ? "Re-open / update day" : "Open day"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Locks the unit for the whole session. {dash.dayOpened ? "Day is open." : "Day not opened yet."}
          </span>
        </div>
      </div>

      {/* Depth protection */}
      <div className="border border-border rounded p-3 space-y-2">
        <div className="terminal-label">// Market depth protection (active above $40k bankroll)</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            inputMode="decimal"
            className="w-40 bg-background border border-border rounded px-2 py-1 text-xs"
            placeholder="Visible book depth $"
          />
          <span
            className={cn(
              "text-[11px]",
              !depthApplies ? "text-muted-foreground"
              : depthFrac == null ? "text-orange-400"
              : depthFrac > 15 ? "text-red-400" : "text-emerald-400",
            )}
          >
            {!depthApplies
              ? "Inactive below $40,000 bankroll"
              : depthFrac == null
                ? "Depth unknown — treated as failing, do not place"
                : depthFrac > 15
                  ? `Order is ${depthFrac.toFixed(1)}% of depth (max 15%) — SPLIT ENTRY REQUIRED`
                  : `Order is ${depthFrac.toFixed(1)}% of depth — OK`}
          </span>
        </div>
      </div>

      {/* Manual trade log */}
      <div className="border border-border rounded p-3 space-y-2">
        <div className="terminal-label">// Log a qualifying trade (manual — no auto-execution)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input className="bg-background border border-border rounded px-2 py-1 text-xs col-span-2" placeholder="Ticker" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} />
          <input className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder="Strike" value={form.strike} onChange={(e) => setForm({ ...form, strike: e.target.value })} />
          <input className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder="Spot at lock" value={form.spot} onChange={(e) => setForm({ ...form, spot: e.target.value })} />
          <select className="bg-background border border-border rounded px-2 py-1 text-xs" value={form.studySide} onChange={(e) => setForm({ ...form, studySide: e.target.value })}>
            <option value="YES">Study: YES</option>
            <option value="NO">Study: NO</option>
          </select>
          <input className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder="Study conf %" value={form.studyConf} onChange={(e) => setForm({ ...form, studyConf: e.target.value })} />
          <select className="bg-background border border-border rounded px-2 py-1 text-xs" value={form.modelSide} onChange={(e) => setForm({ ...form, modelSide: e.target.value })}>
            <option value="YES">Model: YES</option>
            <option value="NO">Model: NO</option>
          </select>
          <input className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder="Model conf %" value={form.modelConf} onChange={(e) => setForm({ ...form, modelConf: e.target.value })} />
          <input className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder="Ask ¢" value={form.ask} onChange={(e) => setForm({ ...form, ask: e.target.value })} />
          <input className="bg-background border border-border rounded px-2 py-1 text-xs" placeholder="Seconds left" value={form.secondsLeft} onChange={(e) => setForm({ ...form, secondsLeft: e.target.value })} />
          <input className="bg-background border border-border rounded px-2 py-1 text-xs col-span-2" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <button
          onClick={doLog}
          disabled={busy}
          className={cn(
            "text-xs uppercase tracking-wider px-3 py-1.5 rounded border disabled:opacity-50",
            disabled ? "border-red-500/60 text-red-400" : "border-border hover:bg-muted",
          )}
        >
          {disabled ? "Log anyway (records a rule violation)" : `Log trade at ${usd(dash.staking.unitUsd)}`}
        </button>
      </div>

      {openTrades.length > 0 && (
        <div className="border border-border rounded p-3 space-y-2">
          <div className="terminal-label">// Open trades today</div>
          {openTrades.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-xs border border-border rounded p-2">
              <span className="font-mono">{t.ticker} · {t.study_side} · {t.ask_cents ?? "—"}¢ · {usd(t.stake)}</span>
              <span className="flex gap-2">
                <button disabled={busy} onClick={() => doSettle(t, "win")} className="px-2 py-1 rounded border border-emerald-500/60 text-emerald-400 uppercase tracking-wider disabled:opacity-50">Win</button>
                <button disabled={busy} onClick={() => doSettle(t, "loss")} className="px-2 py-1 rounded border border-red-500/60 text-red-400 uppercase tracking-wider disabled:opacity-50">Loss</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
