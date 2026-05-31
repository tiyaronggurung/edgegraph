import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useState } from "react";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { ActionBadge } from "@/components/edge/ActionBadge";
import { toast } from "sonner";
import type { ActionType } from "@/lib/analysisEngine";
import { usePlan } from "@/hooks/usePlan";
import { InlineUpgradePrompt } from "@/components/upgrade/UpgradePrompt";
import { formatLimit } from "@/lib/plans/config";

export const Route = createFileRoute("/_authenticated/strategies")({
  head: () => ({ meta: [{ title: "Strategies — EdgeGraph AI" }] }),
  component: Strategies,
});

const PATTERNS = ["Dominant Lock","Controlled Stability","Breakaway Trend","Late Momentum Swing","V-Reversal","Fake Spike","Chaotic Coin Flip","Momentum Exhaustion","Sharp Money Recovery","Volatility Compression","Public Overreaction","Failed Rally","Favorite Confirmation","Underdog Trap"];
const ACTIONS: ActionType[] = ["Bet", "Wait", "Hedge", "Avoid", "Watch Only"];

function Strategies() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { plan, can } = usePlan();
  const q = useQuery({
    queryKey: ["strategies", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("strategies").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const toggle = async (id: string, active: boolean) => {
    await supabase.from("strategies").update({ active: !active }).eq("id", id);
    q.refetch();
  };
  const del = async (id: string) => {
    if (!confirm("Delete strategy?")) return;
    await supabase.from("strategies").delete().eq("id", id);
    q.refetch();
  };

  const count = q.data?.length ?? 0;
  const limit = plan.features.maxStrategies;
  const canSave = can.saveStrategy(count);
  const targetPlan = plan.tier === "free" ? "pro" : "vip";

  return (
    <div className="space-y-5 font-mono">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">// Saved Strategies</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {count} / {formatLimit(limit)} saved · {plan.name} plan
          </p>
        </div>
        <button
          onClick={() => canSave ? setOpen(true) : toast.error(`${plan.name} plan limit reached (${formatLimit(limit)} strategies)`)}
          disabled={!canSave}
          className="text-xs uppercase tracking-wider px-3 py-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New strategy
        </button>
      </div>

      {!canSave && (
        <InlineUpgradePrompt
          title={targetPlan === "pro" ? "Unlock Pro" : "Go Unlimited with VIP"}
          description={`You've reached your ${plan.name} plan limit of ${formatLimit(limit)} saved ${limit === 1 ? "strategy" : "strategies"}. Upgrade for ${targetPlan === "pro" ? "10" : "unlimited"} saves.`}
          context="strategies-limit"
          targetPlan={targetPlan}
        />
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {(q.data ?? []).map((s) => (
          <div key={s.id} className="border border-border bg-card rounded p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div className="font-bold">{s.name}</div>
              <span className={`text-[10px] uppercase tracking-widest ${s.active ? "text-[color:var(--color-primary)]" : "text-muted-foreground"}`}>● {s.active ? "Active" : "Paused"}</span>
            </div>
            <blockquote className="text-xs italic text-muted-foreground border-l-2 border-border pl-3">{s.rules}</blockquote>
            <div className="flex flex-wrap gap-2 items-center">
              <PatternBadge pattern={s.pattern_type ?? "—"} />
              <span className="text-xs text-muted-foreground">Min conf {s.minimum_confidence}%</span>
              <ActionBadge action={(s.recommended_action as ActionType) ?? "Watch Only"} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => toggle(s.id, s.active)} className="text-xs uppercase tracking-wider px-2 py-1 border border-border rounded">{s.active ? "Pause" : "Activate"}</button>
              <button onClick={() => del(s.id)} className="text-xs uppercase tracking-wider px-2 py-1 border border-[color:var(--color-destructive)] text-[color:var(--color-destructive)] rounded">Delete</button>
            </div>
          </div>
        ))}
        {!q.data?.length && <div className="text-muted-foreground text-xs">No strategies yet.</div>}
      </div>
      {open && <StrategyModal userId={user?.id ?? ""} onClose={() => { setOpen(false); q.refetch(); }} />}
    </div>
  );
}

function StrategyModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [f, setF] = useState({ name: "", rules: "", pattern_type: PATTERNS[0], minimum_confidence: "70", recommended_action: "Bet" });
  const upd = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const cls = "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm font-mono";
  const save = async () => {
    const { error } = await supabase.from("strategies").insert({
      user_id: userId, name: f.name, rules: f.rules, pattern_type: f.pattern_type,
      minimum_confidence: Number(f.minimum_confidence), recommended_action: f.recommended_action, active: true,
    });
    if (error) return toast.error(error.message);
    toast.success("Strategy created");
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md border border-border bg-card rounded p-5 space-y-3 font-mono">
        <h3 className="text-lg font-bold">New strategy</h3>
        <label className="block"><span className="terminal-label">Name</span><input className={cls} value={f.name} onChange={(e) => upd("name", e.target.value)} /></label>
        <label className="block"><span className="terminal-label">Rules / conditions</span><textarea rows={3} className={cls} value={f.rules} onChange={(e) => upd("rules", e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label><span className="terminal-label">Pattern</span>
            <select className={cls} value={f.pattern_type} onChange={(e) => upd("pattern_type", e.target.value)}>{PATTERNS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label><span className="terminal-label">Min confidence</span><input type="number" className={cls} value={f.minimum_confidence} onChange={(e) => upd("minimum_confidence", e.target.value)} /></label>
        </div>
        <label><span className="terminal-label">Action</span>
          <select className={cls} value={f.recommended_action} onChange={(e) => upd("recommended_action", e.target.value)}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-border rounded">Cancel</button>
          <button onClick={save} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded">Save</button>
        </div>
      </div>
    </div>
  );
}
