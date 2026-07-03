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
            <KalshiConnectionCard />
            <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">
              Kalshi keys are stored securely per-user and never sent to the browser after saving.
            </p>
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

function KalshiConnectionCard() {
  const saveFn = useServerFn(saveKalshiCreds);
  const statusFn = useServerFn(getKalshiCredsStatus);
  const testFn = useServerFn(testKalshiConnection);

  const status = useQuery({
    queryKey: ["kalshi-creds-status"],
    queryFn: () => statusFn(),
    staleTime: 30_000,
  });

  const [keyId, setKeyId] = useState("");
  const [pem, setPem] = useState("");
  const [editingPem, setEditingPem] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; balanceCents: number | null }
    | { ok: false; error: string }
    | null
  >(null);

  useEffect(() => {
    if (status.data?.apiKeyId) setKeyId(status.data.apiKeyId);
  }, [status.data?.apiKeyId]);

  const hasKeyId = !!status.data?.hasKeyId;
  const hasPem = !!status.data?.hasPem;
  const connected = hasKeyId && hasPem;

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({
        data: {
          apiKeyId: keyId,
          // Only send pem when the user actually edited it; otherwise leave stored value unchanged.
          ...(editingPem ? { privateKeyPem: pem } : {}),
        },
      });
      if (editingPem) {
        setPem("");
        setEditingPem(false);
      }
      toast.success("Kalshi credentials saved");
      status.refetch();
      setTestResult(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };
      // Special sentinel handling: if not editing, we need to preserve the
      // existing PEM. Do that by re-fetching only if they DID edit.
      if (editingPem) {
        setPem("");
        setEditingPem(false);
      }
      toast.success("Kalshi credentials saved");
      status.refetch();
      setTestResult(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testFn();
      setTestResult(res as typeof testResult);
      if (res.ok) toast.success("Kalshi connection verified");
      else toast.error(res.error ?? "Connection failed");
    } catch (e: any) {
      const err = e?.message ?? "Test failed";
      setTestResult({ ok: false, error: err });
      toast.error(err);
    } finally {
      setTesting(false);
    }
  };

  const clear = async () => {
    if (!confirm("Remove your saved Kalshi API credentials?")) return;
    setSaving(true);
    try {
      await saveFn({ data: { apiKeyId: "", privateKeyPem: "" } });
      setKeyId("");
      setPem("");
      setEditingPem(false);
      setTestResult(null);
      toast.success("Kalshi credentials cleared");
      status.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to clear");
    } finally {
      setSaving(false);
    }
  };

  const cls = "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm font-mono";

  return (
    <div className="space-y-3 border border-border/60 bg-background/40 rounded p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider">Kalshi</div>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${
            connected
              ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
              : "border-border text-muted-foreground"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <label className="block">
        <span className="terminal-label">API Key ID</span>
        <input
          className={cls}
          placeholder="e.g. 12345678-abcd-..."
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="block">
        <span className="terminal-label">Private Key (PEM)</span>
        {hasPem && !editingPem ? (
          <div className="flex items-center gap-2">
            <input className={cls + " flex-1"} value="•••••••••••••••••••••••• (stored)" disabled />
            <button
              type="button"
              onClick={() => setEditingPem(true)}
              className="text-[10px] uppercase tracking-widest px-2 py-1.5 border border-border rounded hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
            >
              Replace
            </button>
          </div>
        ) : (
          <textarea
            className={cls + " h-32 whitespace-pre"}
            placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
            value={pem}
            onChange={(e) => {
              setPem(e.target.value);
              if (!editingPem) setEditingPem(true);
            }}
            spellCheck={false}
          />
        )}
        <p className="text-[10px] text-muted-foreground mt-1">
          Paste the full PEM including BEGIN/END lines. Unencrypted PKCS#8 RSA key only.
        </p>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={save}
          disabled={saving || (!keyId.trim() && !editingPem && !hasKeyId)}
          className="text-xs uppercase tracking-wider px-3 py-1.5 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={test}
          disabled={testing || !connected}
          className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] disabled:opacity-40"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {(hasKeyId || hasPem) && (
          <button
            onClick={clear}
            disabled={saving}
            className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-[color:var(--color-destructive)] hover:text-[color:var(--color-destructive)] disabled:opacity-40 ml-auto"
          >
            Remove
          </button>
        )}
      </div>

      {testResult && (
        <div
          className={`text-[11px] font-mono border rounded px-2 py-1.5 ${
            testResult.ok
              ? "border-[color:var(--color-primary)]/40 text-[color:var(--color-primary)]"
              : "border-[color:var(--color-destructive)]/40 text-[color:var(--color-destructive)]"
          }`}
        >
          {testResult.ok
            ? `OK — balance ${
                testResult.balanceCents == null
                  ? "n/a"
                  : `$${(testResult.balanceCents / 100).toFixed(2)}`
              }`
            : testResult.error}
        </div>
      )}
    </div>
  );
}
