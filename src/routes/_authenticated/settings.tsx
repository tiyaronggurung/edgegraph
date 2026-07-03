import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEffect, useState } from "react";
import { SPORTS } from "@/lib/sports";
import { toast } from "sonner";
import { AlertPreferencesCard } from "@/components/settings/AlertPreferencesCard";
import {
  getKalshiCredsStatus,
  saveKalshiCreds,
  testKalshiConnection,
} from "@/lib/kalshiUserConnection.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — EdgeGraph AI" }] }),
  component: Settings,
});

const RISKS = ["Conservative", "Medium", "Aggressive"] as const;
const cls = "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm font-mono";

function Settings() {
  const { user } = useAuth();
  const [showSchema, setShowSchema] = useState(false);
  const [form, setForm] = useState({ bankroll: "1000", default_unit: "25", risk_tolerance: "Medium" });
  const [sports, setSports] = useState<string[]>(SPORTS.map((s) => s.key));

  const q = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data;
    },
  });
  useEffect(() => {
    if (q.data) {
      setForm({
        bankroll: String(q.data.bankroll ?? 1000),
        default_unit: String(q.data.default_unit ?? 25),
        risk_tolerance: q.data.risk_tolerance ?? "Medium",
      });
      setSports(q.data.preferred_sports ?? []);
    }
  }, [q.data]);

  const save = async () => {
    const { error } = await supabase.from("profiles").update({
      bankroll: Number(form.bankroll), default_unit: Number(form.default_unit),
      risk_tolerance: form.risk_tolerance, preferred_sports: sports,
    }).eq("id", user!.id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  return (
    <div className="space-y-5 font-mono">
      <h1 className="text-2xl font-bold uppercase tracking-wider">// Settings</h1>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-border bg-card rounded p-4 space-y-3">
          <h2 className="terminal-label">// Profile</h2>
          <label className="block"><span className="terminal-label">Email</span><input disabled className={cls} value={user?.email ?? ""} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="terminal-label">Bankroll ($)</span><input type="number" className={cls} value={form.bankroll} onChange={(e) => setForm((f) => ({ ...f, bankroll: e.target.value }))} /></label>
            <label><span className="terminal-label">Default unit ($)</span><input type="number" className={cls} value={form.default_unit} onChange={(e) => setForm((f) => ({ ...f, default_unit: e.target.value }))} /></label>
          </div>
          <div>
            <div className="terminal-label mb-2">Risk tolerance</div>
            <div className="flex gap-2">
              {RISKS.map((r) => (
                <button key={r} onClick={() => setForm((f) => ({ ...f, risk_tolerance: r }))}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${form.risk_tolerance === r ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]" : "border-border text-muted-foreground"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <button onClick={save} className="w-full py-2 mt-2 text-xs uppercase tracking-wider border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded">Save profile</button>
        </div>

        <div className="border border-border bg-card rounded p-4 space-y-4">
          <div>
            <h2 className="terminal-label mb-2">// Preferred sports</h2>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => {
                const on = sports.includes(s.key);
                return (
                  <button key={s.key} onClick={() => setSports((arr) => on ? arr.filter((x) => x !== s.key) : [...arr, s.key])}
                    className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${on ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]" : "border-border text-muted-foreground"}`}>
                    {s.icon} {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <h2 className="terminal-label mb-2">// API connectors</h2>
            <div className="space-y-2">
              {["Kalshi", "Sports Data", "Odds API"].map((n) => (
                <div key={n} className="flex gap-2 items-center">
                  <span className="text-xs w-28">{n}</span>
                  <input className={cls + " flex-1"} placeholder={`${n} API key…`} />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">Connectors in manual mode — keys stored securely server-side once enabled.</p>
          </div>
          <div>
            <button onClick={() => setShowSchema((v) => !v)} className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
              {showSchema ? "▾" : "▸"} Schema reference
            </button>
            {showSchema && (
              <pre className="mt-2 text-[10px] text-muted-foreground bg-background border border-border rounded p-3 overflow-auto">
{`profiles(id, email, bankroll, default_unit, risk_tolerance, preferred_sports)
analyses(id, user_id, sport, team_a, team_b, score, time_period,
  probability_a/b, odds_a/b, volume, pattern_type, predicted_winner,
  confidence_score, edge_score, risk_level, recommended_action,
  ai_reasoning, edge70_detected, sport_fields, notes)
bets(id, user_id, analysis_id, game, date, sport, pick, odds, stake,
  pattern_type, confidence_score, edge_score, result, profit_loss, notes)
patterns(id, name, description, risk_level, recommended_action,
  condition_logic, example_behavior, icon, best_use)
strategies(id, user_id, name, rules, pattern_type, minimum_confidence,
  recommended_action, active)
graph_snapshots(id, analysis_id, user_id, timestamp,
  probability_a/b, odds_a/b, volume, score_state, event_trigger)`}
              </pre>
            )}
          </div>
        </div>
        <AlertPreferencesCard />
      </div>
    </div>
  );
}
