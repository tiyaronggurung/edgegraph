import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, Ban } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { opsAcknowledgeAlert } from "@/lib/opsManual/opsManual.functions";
import type { OpsDashboard, OpsAlertRow } from "./types";
import { cn } from "@/lib/utils";

const LEVEL_META = {
  green: { label: "GREEN — ACTIVE", cls: "border-emerald-500/60 bg-emerald-500/10 text-emerald-400", Icon: CheckCircle2 },
  yellow: { label: "YELLOW — WATCH", cls: "border-yellow-500/60 bg-yellow-500/10 text-yellow-400", Icon: AlertTriangle },
  orange: { label: "ORANGE — RISK REDUCED", cls: "border-orange-500/60 bg-orange-500/10 text-orange-400", Icon: ShieldAlert },
  red: { label: "RED — TRADING DISABLED", cls: "border-red-500/70 bg-red-500/10 text-red-400", Icon: Ban },
} as const;

export function OpsStatusBanner({ dash, onRefresh }: { dash: OpsDashboard; onRefresh: () => void }) {
  const ack = useServerFn(opsAcknowledgeAlert);
  const [busy, setBusy] = useState<string | null>(null);

  const level: keyof typeof LEVEL_META =
    dash.status.status === "kill_switch" ? "red"
    : dash.status.status === "risk_reduced" ? "orange"
    : dash.status.status === "watch" ? "yellow" : "green";
  const meta = LEVEL_META[level];
  const Icon = meta.Icon;

  const unacked = ((dash.alerts ?? []) as OpsAlertRow[]).filter(
    (a) => a.level === "red" && !a.acknowledged_at && !a.resolved_at,
  );

  const doAck = async (id: string) => {
    setBusy(id);
    try {
      await ack({ data: { id } });
      toast.success("Alert acknowledged — trading is NOT restored");
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className={cn("border rounded p-4 flex items-start gap-3", meta.cls)}>
        <Icon className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div className="font-bold uppercase tracking-widest text-sm">{meta.label}</div>
          <p className="text-xs text-muted-foreground">{dash.status.reason}</p>
          <div className="text-[11px] text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 pt-1">
            <span>Metric: <b className="text-foreground">{dash.status.metric}</b></span>
            <span>Current: <b className="text-foreground">
              {dash.status.currentValue == null ? "—" : `${(dash.status.currentValue * 100).toFixed(1)}%`}
            </b></span>
            <span>Threshold: <b className="text-foreground">{(dash.status.thresholdValue * 100).toFixed(0)}%</b></span>
            <span>Mode: <b className="text-foreground uppercase">{dash.staking.mode.replace("_", " ")}</b></span>
          </div>
        </div>
      </div>

      {unacked.length > 0 && (
        <div className="border border-red-500/60 bg-red-500/5 rounded p-3 space-y-2">
          <div className="terminal-label text-red-400">// Unacknowledged kill-switch alerts</div>
          {unacked.map((a) => (
            <div key={a.id} className="text-xs border border-border rounded p-2 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold uppercase">{a.code}</span>
                <span className="text-muted-foreground">{new Date(a.triggered_at).toUTCString()}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>Value: <b className="text-foreground">{a.current_value ?? "—"}</b></span>
                <span>Threshold: <b className="text-foreground">{a.threshold_value ?? "—"}</b></span>
                <span>Manual review: <b className="text-foreground">{a.manual_review_required ? "YES" : "no"}</b></span>
              </div>
              <div className="text-[11px]">Action taken: {a.action_taken ?? "—"}</div>
              <div className="text-[11px]">Resume when: {a.resume_conditions ?? "—"}</div>
              <button
                disabled={busy === a.id}
                onClick={() => doAck(a.id)}
                className="text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-red-500/60 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                Acknowledge (does not resume trading)
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
