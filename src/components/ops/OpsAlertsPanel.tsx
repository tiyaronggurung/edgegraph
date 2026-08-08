import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { opsAcknowledgeAlert, opsRecordWithdrawal, opsRecordThresholdChange } from "@/lib/opsManual/opsManual.functions";
import type { OpsDashboard, OpsAlertRow } from "./types";
import { cn } from "@/lib/utils";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

const LEVEL_STYLE: Record<string, string> = {
  red: "border-red-500/60 text-red-400",
  orange: "border-orange-500/60 text-orange-400",
  yellow: "border-yellow-500/60 text-yellow-400",
  green: "border-emerald-500/60 text-emerald-400",
};

export function OpsAlertsPanel({ dash, onRefresh }: { dash: OpsDashboard; onRefresh: () => void }) {
  const ack = useServerFn(opsAcknowledgeAlert);
  const withdraw = useServerFn(opsRecordWithdrawal);
  const recordChange = useServerFn(opsRecordThresholdChange);
  const [busy, setBusy] = useState(false);
  const [wd, setWd] = useState("");
  const [chg, setChg] = useState({ key: "", previousValue: "", newValue: "", reason: "" });

  const alerts = (dash.alerts ?? []) as OpsAlertRow[];
  const ms = dash.nextMilestone;

  const doAck = async (id: string) => {
    setBusy(true);
    try {
      await ack({ data: { id } });
      toast.success("Alert acknowledged");
      onRefresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const doWithdraw = async () => {
    if (!ms) return toast.error("No milestone pending");
    setBusy(true);
    try {
      const r = await withdraw({ data: { milestoneTo: ms.to, amount: Number(wd) } });
      if (!r.ok) throw new Error(r.error);
      toast.success("Withdrawal recorded");
      setWd("");
      onRefresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const doChange = async () => {
    if (chg.reason.trim().length < 3) return toast.error("A written reason is required");
    setBusy(true);
    try {
      const r = await recordChange({
        data: {
          key: chg.key.trim(),
          previousValue: chg.previousValue.trim() || null,
          newValue: chg.newValue.trim(),
          reason: chg.reason.trim(),
        },
      });
      if (!r.ok) throw new Error(r.error);
      toast.success("Threshold change recorded in the audit trail");
      setChg({ key: "", previousValue: "", newValue: "", reason: "" });
      onRefresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Kill-switch alerts */}
      <div className="border border-border bg-card rounded p-4 space-y-3">
        <div className="terminal-label">// Kill-switch and warning alerts</div>
        <div className="grid sm:grid-cols-3 gap-2 text-[11px]">
          <div className="border border-emerald-500/40 rounded p-2">
            <b className="text-emerald-400">Green — healthy</b>
            <div className="text-muted-foreground">Rolling 30 win rate at or above 88%. Standard compounding unit (5%, 3% at $10k+).</div>
          </div>
          <div className="border border-yellow-500/40 rounded p-2">
            <b className="text-yellow-400">Yellow — watch</b>
            <div className="text-muted-foreground">Rolling 30 between 82% and 88%. Standard unit, review daily.</div>
          </div>
          <div className="border border-orange-500/40 rounded p-2">
            <b className="text-orange-400">Orange — risk reduced</b>
            <div className="text-muted-foreground">Rolling 30 below 82%. Unit drops to 6% until 30 settled bets recover the rate.</div>
          </div>
          <div className="border border-red-500/40 rounded p-2 sm:col-span-3">
            <b className="text-red-400">Red — kill switch</b>
            <div className="text-muted-foreground">
              Rolling 100 below 78%, drawdown above 30%, feed outage, or a Kalshi structure/fee/settlement change.
              Trading is disabled and manual review is required before resuming.
            </div>
          </div>
        </div>

        {alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No alerts have fired.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className={cn("border rounded p-2 text-xs flex flex-wrap items-center justify-between gap-2", LEVEL_STYLE[a.level] ?? "border-border")}>
                <span>
                  <b className="uppercase">{a.level}</b> · {a.code}
                  {a.metric && <> · {a.metric} {a.current_value != null ? `= ${a.current_value}` : ""} vs {a.threshold_value}</>}
                  {a.action_taken && <> · action: {a.action_taken}</>}
                  {a.resume_conditions && <> · resume when: {a.resume_conditions}</>}
                  <span className="text-muted-foreground"> · {new Date(a.triggered_at).toLocaleString()}</span>
                </span>
                {!a.acknowledged_at && (
                  <button disabled={busy} onClick={() => doAck(a.id)} className="px-2 py-1 rounded border border-border uppercase tracking-wider disabled:opacity-50">
                    Acknowledge
                  </button>
                )}
                {a.acknowledged_at && <span className="text-muted-foreground">acknowledged</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawals */}
      <div className="border border-border bg-card rounded p-4 space-y-3">
        <div className="terminal-label">// Withdrawal ladder — bank 20% of profit at every doubling from $10,000</div>
        <table className="w-full text-[11px] font-mono">
          <thead className="text-muted-foreground uppercase tracking-wider">
            <tr className="border-b border-border">
              <th className="text-left py-1">Milestone</th>
              <th className="text-right py-1">Required withdrawal</th>
              <th className="text-right py-1">Withdrawn</th>
              <th className="text-right py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {dash.milestones.map((m) => {
              const rec = dash.withdrawals.find((w) => Number(w.milestone_to) === m.to);
              const reached = dash.summary.currentBankroll >= m.to;
              return (
                <tr key={m.to} className="border-b border-border/40">
                  <td className="py-1">${m.from.toLocaleString()} → ${m.to.toLocaleString()}</td>
                  <td className="py-1 text-right">{usd(m.required)}</td>
                  <td className="py-1 text-right">{usd(Number(rec?.withdrawn_amount ?? 0))}</td>
                  <td className={cn("py-1 text-right uppercase", rec?.status === "completed" ? "text-emerald-400" : reached ? "text-orange-400" : "text-muted-foreground")}>
                    {rec?.status === "completed" ? "banked" : reached ? "due" : "not reached"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ms && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Next: bank {usd(ms.required)} when bankroll reaches ${ms.to.toLocaleString()}.
            </span>
            <input value={wd} onChange={(e) => setWd(e.target.value)} inputMode="decimal" placeholder="Amount withdrawn" className="w-40 bg-background border border-border rounded px-2 py-1 text-xs" />
            <button disabled={busy} onClick={doWithdraw} className="text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50">
              Record withdrawal
            </button>
          </div>
        )}
      </div>

      {/* Audit trail */}
      <div className="border border-border bg-card rounded p-4 space-y-3">
        <div className="terminal-label">// Threshold audit trail — every change needs a written reason</div>
        <div className="grid sm:grid-cols-4 gap-2">
          <input value={chg.key} onChange={(e) => setChg({ ...chg, key: e.target.value })} placeholder="Threshold key" className="bg-background border border-border rounded px-2 py-1 text-xs" />
          <input value={chg.previousValue} onChange={(e) => setChg({ ...chg, previousValue: e.target.value })} placeholder="Previous value" className="bg-background border border-border rounded px-2 py-1 text-xs" />
          <input value={chg.newValue} onChange={(e) => setChg({ ...chg, newValue: e.target.value })} placeholder="New value" className="bg-background border border-border rounded px-2 py-1 text-xs" />
          <input value={chg.reason} onChange={(e) => setChg({ ...chg, reason: e.target.value })} placeholder="Reason (required)" className="bg-background border border-border rounded px-2 py-1 text-xs" />
        </div>
        <button disabled={busy} onClick={doChange} className="text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50">
          Record change
        </button>
        <div className="space-y-1 text-[11px] font-mono">
          {dash.thresholdChanges.length === 0 && <p className="text-muted-foreground">No threshold has been changed.</p>}
          {(dash.thresholdChanges as Array<Record<string, string>>).map((c) => (
            <div key={String(c.id)} className="border-b border-border/40 py-1">
              <b>{c.threshold_key}</b>: {c.previous_value ?? "—"} → {c.new_value} · {c.reason}{" "}
              <span className="text-muted-foreground">{new Date(c.changed_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Violations */}
      <div className="border border-border bg-card rounded p-4 space-y-2">
        <div className="terminal-label">// Rule violations — {dash.weeklyViolations} in the last 7 days (2 disables trading)</div>
        {dash.violations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No violations recorded. Discipline is intact.</p>
        ) : (
          <div className="space-y-1 text-[11px] font-mono">
            {dash.violations.map((v, i) => (
              <div key={i} className="border-b border-border/40 py-1 text-red-400">
                {v.session_date} · {v.rule_code} · <span className="text-muted-foreground">{v.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
