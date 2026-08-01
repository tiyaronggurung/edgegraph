import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  opsAutoGetStatus,
  opsAutoSetEnabled,
  opsAutoPreview,
} from "@/lib/opsManual/opsAutoTrade.functions";
import { cn } from "@/lib/utils";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

export function OpsAutoTradePanel() {
  const qc = useQueryClient();
  const getStatus = useServerFn(opsAutoGetStatus);
  const setEnabled = useServerFn(opsAutoSetEnabled);
  const preview = useServerFn(opsAutoPreview);

  const q = useQuery({
    queryKey: ["ops-auto-status"],
    queryFn: () => getStatus({}),
    refetchInterval: 20_000,
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setEnabled({ data: { enabled } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.enabled ? "Ops auto-trade ARMED — real money" : "Ops auto-trade disarmed");
      else toast.error(r.error);
      qc.invalidateQueries({ queryKey: ["ops-auto-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dry = useMutation({
    mutationFn: () => preview({}),
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  const armed = !!d?.enabled;

  const Gate = ({ ok, label }: { ok: boolean; label: string }) => (
    <li className="flex items-start gap-2 text-xs">
      {ok ? (
        <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
      ) : (
        <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="terminal-label flex items-center gap-2">
          <Bot className="h-4 w-4" />
          // Auto-trade under Operating-Manual rules (real money)
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => dry.mutate()}
            disabled={dry.isPending}
            className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-background"
          >
            {dry.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Dry run"}
          </button>
          <button
            onClick={() => toggle.mutate(!armed)}
            disabled={toggle.isPending || !d?.hasKeys}
            className={cn(
              "text-xs uppercase tracking-wider px-3 py-1.5 rounded border",
              armed
                ? "border-red-500/50 bg-red-500/10 text-red-300"
                : "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {armed ? "Disarm" : "Arm auto-trade"}
          </button>
        </div>
      </div>

      {!d?.hasKeys && (
        <p className="text-xs text-orange-400">
          No exchange keys on your profile — add them in Settings before arming.
        </p>
      )}

      <div className="grid sm:grid-cols-4 gap-3">
        {[
          ["State", armed ? "ARMED" : "OFF"],
          ["Stake per bet", money(d?.unitUsd)],
          ["Bets left today", d ? String(d.betsRemaining) : "—"],
          ["Day P/L", money(d?.dailyPnl)],
        ].map(([k, v]) => (
          <div key={k} className="border border-border rounded p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
            <div className={cn("text-sm font-bold", k === "State" && armed && "text-emerald-400")}>{v}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-widest mb-2">How a bet is picked</div>
        <ul className="space-y-1.5">
          <Gate ok={!!d?.dayOpened} label="Trading day opened (morning bankroll fixed)" />
          <Gate ok={!!d && !d.stopped} label={d?.stopped ? `Session stopped — ${d.stopReason}` : "No daily stop hit"} />
          <Gate ok={d?.stakingMode !== "disabled"} label={d?.stakingMode === "disabled" ? `Staking disabled — ${d?.stakingReason}` : `Staking mode: ${d?.stakingMode ?? "—"}`} />
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          Then, every 30 seconds, each open 15-minute window is checked against the qualification card:
          T7 study lock, study confidence ≥ 90%, cushion ≥ $40, ask ≤ 80¢, model agrees with study,
          at least two minutes left, and an allowed UTC hour. The first window that passes all seven gets
          one immediate-or-cancel buy at the ask, sized to the fixed unit. Nothing else fires that tick.
        </p>
      </div>

      {dry.data && (
        <div className="border border-border rounded p-3 space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Dry run — {dry.data.reason ?? `${dry.data.attempts.length} window(s) evaluated`}
          </div>
          {dry.data.attempts.map((a) => (
            <div key={a.ticker} className="text-xs flex items-center justify-between gap-2">
              <span className="truncate">{a.ticker}</span>
              <span className={a.reason === "would_fire" ? "text-emerald-400" : "text-muted-foreground"}>
                {a.reason}
                {a.askCents != null ? ` · ${a.askCents}¢` : ""}
                {a.cushionUsd != null ? ` · $${a.cushionUsd.toFixed(0)} cushion` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {!!d?.autoTrades?.length && (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-2">Auto-fired bets</div>
          <div className="space-y-1">
            {(d.autoTrades as Array<Record<string, any>>).map((t) => (
              <div key={t.id} className="text-xs flex items-center justify-between gap-2 border-b border-border/50 py-1">
                <span className="truncate">{t.ticker}</span>
                <span className="text-muted-foreground">
                  {t.side} · {t.contracts ?? "—"}x @ {t.ask_cents ?? "—"}¢ · {money(Number(t.stake))}
                </span>
                <span
                  className={cn(
                    "w-20 text-right",
                    t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "text-muted-foreground",
                  )}
                >
                  {t.result ? `${t.result} ${money(t.realized_pnl)}` : "open"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
