import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStakingConfig, updateStakingConfig } from "@/lib/stakingConfig.functions";
import type { LadderConfig } from "@/lib/profitBankLadder";

type Field = {
  key: keyof LadderConfig;
  label: string;
  step: number;
  hint?: string;
  isPct?: boolean;
};

const FIELDS: Field[] = [
  { key: "baseStake", label: "Base Stake ($)", step: 5 },
  { key: "unlockWins", label: "Unlock Wins", step: 1 },
  { key: "profitBankStartPct", label: "Profit Bank Start %", step: 0.05, isPct: true, hint: "Initial stake = bank × this" },
  { key: "winGrowthPct", label: "Win Growth %", step: 0.05, isPct: true },
  { key: "lossReduction1Pct", label: "Loss #1 Reduction %", step: 0.05, isPct: true },
  { key: "lossReduction2Pct", label: "Loss #2 Reduction %", step: 0.05, isPct: true },
  { key: "maxStake", label: "Max Stake ($)", step: 10 },
  { key: "maxProfitExposurePct", label: "Max Profit Exposure %", step: 0.05, isPct: true },
  { key: "maxConsecutiveLosses", label: "Max Consecutive Losses", step: 1 },
];

export function StakingConfigPanel() {
  const get = useServerFn(getStakingConfig);
  const upd = useServerFn(updateStakingConfig);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["stakingConfig"],
    queryFn: () => get(),
  });
  const [form, setForm] = useState<LadderConfig | null>(null);

  useEffect(() => {
    if (data && data.ok) setForm(data.config);
  }, [data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<LadderConfig>) => upd({ data: patch }),
    onSuccess: (res) => {
      if (res && res.ok) {
        toast.success("Staking config saved");
        refetch();
      } else {
        toast.error(res && "error" in res ? res.error : "Save failed");
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !form) {
    return <div className="text-xs text-muted-foreground uppercase tracking-widest">Loading staking config…</div>;
  }

  return (
    <div className="border border-border bg-card rounded p-4 space-y-3">
      <div className="terminal-label">// Profit Bank Ladder — staking config</div>
      <p className="text-xs text-muted-foreground">
        Long-term compounding engine. Base bankroll never touched — only profit funds Profit Mode.
        All limits hard-cap every calculation.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FIELDS.map((f) => {
          const raw = form[f.key];
          const displayValue = f.isPct ? Number(raw) * 100 : Number(raw);
          return (
            <label key={f.key} className="flex flex-col gap-1 text-xs">
              <span className="uppercase tracking-wider text-muted-foreground">
                {f.label}{f.isPct ? "" : ""}
              </span>
              <input
                type="number"
                step={f.isPct ? 1 : f.step}
                value={Number.isFinite(displayValue) ? displayValue : 0}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setForm({ ...form, [f.key]: f.isPct ? n / 100 : n });
                }}
                className="bg-background border border-border rounded px-2 py-1.5 font-mono text-sm"
              />
              {f.hint ? <span className="text-[10px] text-muted-foreground">{f.hint}</span> : null}
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
          {save.isPending ? "Saving…" : "Save config"}
        </button>
        <button
          disabled={save.isPending}
          onClick={() => {
            const defaults: LadderConfig = {
              baseStake: 100,
              unlockWins: 3,
              profitBankStartPct: 0.25,
              winGrowthPct: 0.10,
              lossReduction1Pct: 0.30,
              lossReduction2Pct: 0.50,
              maxStake: 150,
              maxProfitExposurePct: 0.40,
              maxConsecutiveLosses: 3,
            };
            setForm(defaults);
            save.mutate(defaults);
          }}
          className="text-xs uppercase tracking-wider px-3 py-2 rounded border border-border hover:border-[color:var(--color-primary)]"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
