import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, RotateCw, Shield } from "lucide-react";
import { toast } from "sonner";
import {
  getRecoveryState,
  setRecoveryEnabled,
  resetRecoverySession,
  clearRecoveryDeficit,
} from "@/lib/martingaleRecovery.functions";

const fmt$ = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function MartingaleRecoveryPanel() {
  const qc = useQueryClient();
  const getState = useServerFn(getRecoveryState);
  const setEnabled = useServerFn(setRecoveryEnabled);
  const resetSess = useServerFn(resetRecoverySession);
  const clearDef = useServerFn(clearRecoveryDeficit);
  const [confirmOn, setConfirmOn] = useState(false);

  const { data: state, isLoading } = useQuery({
    queryKey: ["martingaleRecovery"],
    queryFn: () => getState(),
    refetchInterval: 15_000,
  });

  const toggle = useMutation({
    mutationFn: (v: boolean) => setEnabled({ data: { enabled: v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["martingaleRecovery"] }),
  });
  const doReset = useMutation({
    mutationFn: () => resetSess(),
    onSuccess: () => {
      toast.success("Session reset");
      qc.invalidateQueries({ queryKey: ["martingaleRecovery"] });
    },
  });
  const doClear = useMutation({
    mutationFn: () => clearDef(),
    onSuccess: () => {
      toast.success("Deficit cleared");
      qc.invalidateQueries({ queryKey: ["martingaleRecovery"] });
    },
  });

  const s = state;
  const inRecovery = s ? Number(s.deficit_usd) > Number(s.accepted_deficit_usd) : false;
  const winsLeft = s ? Math.max(0, 3 - Number(s.recovery_wins_completed)) : 3;

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[color:var(--color-primary)]" />
            <h3 className="text-sm font-bold uppercase tracking-wider">
              Martingale Recovery Auto-Trader
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Fires shadow bets on Kalshi BTC 15m ATM markets when Kalshi's favored side is
            70–80¢ AND the model's prediction agrees. Bet sizing is payout-aware: after a
            loss, next 3 wins recover most of it (up to $15 acceptable remaining deficit).
            Session cap {s ? fmt$(Number(s.session_loss_cap_usd)) : "$200"} · Max stake{" "}
            {s ? fmt$(Number(s.max_stake_usd)) : "$150"}.
          </p>
        </div>
        <div className="shrink-0">
          {isLoading ? (
            <div className="text-xs text-muted-foreground">…</div>
          ) : s?.enabled ? (
            <button
              onClick={() => toggle.mutate(false)}
              className="text-xs uppercase tracking-wider px-3 py-1.5 border border-red-500/60 text-red-400 rounded hover:bg-red-500/10"
            >
              Disable
            </button>
          ) : (
            <button
              onClick={() => setConfirmOn(true)}
              className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
            >
              Enable
            </button>
          )}
        </div>
      </div>

      {s?.stopped_reason && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-red-300">
          <AlertTriangle className="h-4 w-4" />
          <span className="uppercase tracking-wider">Stopped:</span>
          <span>{s.stopped_reason.replace(/_/g, " ")}</span>
          <button
            onClick={() => doReset.mutate()}
            className="ml-auto px-2 py-0.5 border border-red-500/60 rounded hover:bg-red-500/20"
          >
            Reset session
          </button>
        </div>
      )}

      {s && s.enabled && (
        <div className={`rounded border p-3 space-y-2 text-xs ${inRecovery ? "border-yellow-500/40 bg-yellow-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
          <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
            Recovery Mode: {inRecovery ? <span className="text-yellow-400">Active</span> : <span className="text-emerald-400">Idle (base stake)</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 font-mono">
            <Stat label="Initial Deficit" value={fmt$(Number(s.initial_deficit_usd))} />
            <Stat label="Current Deficit" value={fmt$(Number(s.deficit_usd))} />
            <Stat label="Accepted Remaining" value={fmt$(Number(s.accepted_deficit_usd))} />
            <Stat label="Recovery Wins" value={`${Number(s.recovery_wins_completed)} / 3`} />
            <Stat label="Wins Remaining" value={`${winsLeft}`} />
            <Stat label="Consec Recovery Losses" value={`${Number(s.consec_recovery_losses)} / ${Number(s.max_consec_recovery_losses)}`} />
            <Stat
              label="Session Loss"
              value={`${fmt$(Number(s.session_loss_usd))} / ${fmt$(Number(s.session_loss_cap_usd))}`}
            />
            <Stat label="Base Stake" value={fmt$(Number(s.base_stake_usd))} />
            <Stat label="Max Stake" value={fmt$(Number(s.max_stake_usd))} />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => doReset.mutate()}
              className="text-[10px] uppercase tracking-wider px-2 py-1 border border-border rounded hover:bg-muted/30 inline-flex items-center gap-1"
            >
              <RotateCw className="h-3 w-3" /> Reset session
            </button>
            {inRecovery && (
              <button
                onClick={() => doClear.mutate()}
                className="text-[10px] uppercase tracking-wider px-2 py-1 border border-border rounded hover:bg-muted/30"
              >
                Clear deficit (skip recovery)
              </button>
            )}
          </div>
        </div>
      )}

      {confirmOn && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setConfirmOn(false)}>
          <div className="bg-card border border-border rounded-lg p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <h4 className="font-bold">Enable Martingale Recovery?</h4>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4 mb-4">
              <li>Fires only when favored side is 70–80¢ AND model agrees</li>
              <li>Base stake $50. Loss triggers payout-aware recovery across up to 3 wins</li>
              <li>Max single stake $150 · Session loss cap $200</li>
              <li>Auto-stops after {s ? Number(s.max_consec_recovery_losses) : 2} consecutive recovery losses</li>
              <li>SHADOW MODE — logs to auto_trade_odds_shadow, no live Kalshi orders</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmOn(false)} className="text-xs px-3 py-1.5 border border-border rounded">
                Cancel
              </button>
              <button
                onClick={() => { toggle.mutate(true); setConfirmOn(false); }}
                className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
