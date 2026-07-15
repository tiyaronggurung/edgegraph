import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAutoExitConfig,
  updateAutoExitConfig,
  DEFAULT_AUTO_EXIT_CONFIG,
  type AutoExitConfig,
} from "@/lib/autoExitConfig.functions";

type Field = {
  key: keyof AutoExitConfig;
  label: string;
  hint: string;
  isPct?: boolean;
  step: number;
  min: number;
  max: number;
};

const FIELDS: Field[] = [
  { key: "exit_tp_frac", label: "Take-profit %", hint: "Close when mark PnL ≥ this % of stake", isPct: true, step: 5, min: 5, max: 500 },
  { key: "exit_sl_frac", label: "Stop-loss %", hint: "Close when mark PnL ≤ −(this % of stake)", isPct: true, step: 5, min: 5, max: 100 },
  { key: "exit_late_sl_frac", label: "Late-window SL %", hint: "Tighter SL under 180s to expiry", isPct: true, step: 5, min: 5, max: 100 },
  { key: "exit_edge_decay_cents", label: "Edge decay (¢)", hint: "Bail when price moved this many ¢ against entry", step: 1, min: 1, max: 50 },
  { key: "exit_odds_flip_cents", label: "Odds-flip (¢)", hint: "Hard bail — Kalshi mark −Xc vs entry", step: 1, min: 1, max: 50 },
  { key: "exit_flip_prob", label: "Model-flip prob", hint: "Bail when live model prob < this for our side", isPct: true, step: 5, min: 0, max: 100 },
];

export function AutoExitConfigPanel() {
  const getFn = useServerFn(getAutoExitConfig);
  const updFn = useServerFn(updateAutoExitConfig);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["auto-exit-config"],
    queryFn: () => getFn(),
  });
  const [form, setForm] = useState<AutoExitConfig | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (patch: AutoExitConfig) => updFn({ data: patch }),
    onSuccess: () => {
      toast.success("Auto-exit config saved — takes effect on next tick");
      refetch();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !form) {
    return <div className="text-xs text-muted-foreground uppercase tracking-widest">Loading auto-exit config…</div>;
  }

  return (
    <div className="border border-border bg-card rounded p-4 space-y-3">
      <div>
        <div className="terminal-label">// Auto-Exit thresholds</div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Live values used by the model's exit sweep every tick. Applies to both live and paper orders.
          Ladder / martingale / model_bet-specific rules still fire in parallel.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FIELDS.map((f) => {
          const raw = form[f.key];
          const display = f.isPct ? Number(raw) * 100 : Number(raw);
          return (
            <label key={f.key} className="flex flex-col gap-1 text-xs">
              <span className="uppercase tracking-wider text-muted-foreground">{f.label}</span>
              <input
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={Number.isFinite(display) ? display : 0}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setForm({ ...form, [f.key]: f.isPct ? n / 100 : Math.round(n) });
                }}
                className="bg-background border border-border rounded px-2 py-1.5 font-mono text-sm"
              />
              <span className="text-[10px] text-muted-foreground">{f.hint}</span>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button
          disabled={save.isPending}
          onClick={() => save.mutate(form)}
          className="text-xs uppercase tracking-wider px-3 py-2 rounded border border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10 hover:bg-[color:var(--color-primary)]/20 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button
          disabled={save.isPending}
          onClick={() => {
            setForm(DEFAULT_AUTO_EXIT_CONFIG);
            save.mutate(DEFAULT_AUTO_EXIT_CONFIG);
          }}
          className="text-xs uppercase tracking-wider px-3 py-2 rounded border border-border hover:border-[color:var(--color-primary)]"
        >
          Reset to defaults
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono border-t border-border/50 pt-2">
        Current: TP +{(form.exit_tp_frac * 100).toFixed(0)}% · SL −{(form.exit_sl_frac * 100).toFixed(0)}%
        {" "}(late −{(form.exit_late_sl_frac * 100).toFixed(0)}%) · edge {form.exit_edge_decay_cents}¢ ·
        {" "}odds-flip {form.exit_odds_flip_cents}¢ · model-flip &lt; {(form.exit_flip_prob * 100).toFixed(0)}%
      </div>
    </div>
  );
}
