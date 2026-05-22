import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ConfidenceGauge } from "@/components/edge/ConfidenceGauge";
import { MiniProbChart } from "@/components/edge/MiniProbChart";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { RiskBadge } from "@/components/edge/RiskBadge";
import { ActionBadge } from "@/components/edge/ActionBadge";
import { Edge70Badge } from "@/components/edge/Edge70Badge";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { DeepAnalyzePanel } from "@/components/edge/DeepAnalyzePanel";
import { generateSimulatedSeries, type Pattern, type ActionType, type Risk } from "@/lib/analysisEngine";

import { sportIcon } from "@/lib/sports";
import { useAuth } from "@/components/auth/AuthProvider";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/analysis/$id")({
  head: () => ({ meta: [{ title: "Analysis result — EdgeGraph AI" }] }),
  component: AnalysisResult,
});

function AnalysisResult() {
  const { id } = useParams({ from: "/_authenticated/analysis/$id" });
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["analysis", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("analyses").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  if (q.isLoading) return <div className="text-muted-foreground text-xs">Loading…</div>;
  if (!q.data) return <div className="text-destructive">Not found.</div>;
  const a = q.data;
  const reasoning = (a.ai_reasoning ?? "").split("\n").filter(Boolean);
  const series = generateSimulatedSeries((a.pattern_type as Pattern) ?? "Controlled Stability", Number(a.confidence_score ?? 70));

  return (
    <div className="space-y-5 font-mono">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">← Back</Link>
        <button
          onClick={() => setOpen(true)}
          className="text-xs uppercase tracking-wider px-3 py-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
        >
          + Save to backtest
        </button>
      </div>

      <div className="border border-border bg-card rounded p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-widest">Predicted winner</div>
            <div className="text-3xl font-bold neon-text mt-1">{a.predicted_winner}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {sportIcon(a.sport)} {a.team_a} vs {a.team_b} · {a.score} · {a.time_period}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Edge70Badge detected={!!a.edge70_detected} />
            <PatternBadge pattern={a.pattern_type ?? "—"} />
            <RiskBadge risk={(a.risk_level as Risk) ?? "Medium"} />
            <ActionBadge action={(a.recommended_action as ActionType) ?? "Watch Only"} />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="border border-border bg-card rounded p-4 flex flex-col items-center">
          <ConfidenceGauge value={Number(a.confidence_score ?? 0)} />
        </div>
        <div className="border border-border bg-card rounded p-4 space-y-3">
          <div>
            <div className="terminal-label">Edge Score</div>
            <div className="text-3xl font-bold neon-text">{Number(a.edge_score ?? 0).toFixed(1)}<span className="text-sm text-muted-foreground"> / 10</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <div className="terminal-label">Momentum</div>
              <div className="text-sm">{Number(a.probability_a) >= 50 ? "Toward A" : "Toward B"}</div>
            </div>
            <div>
              <div className="terminal-label">Volatility</div>
              <div className="text-sm">{a.risk_level}</div>
            </div>
          </div>
        </div>
        <div className="border border-border bg-card rounded p-4">
          <div className="terminal-label mb-2">// Edge70 detector</div>
          {a.edge70_detected ? (
            <p className="text-xs text-[color:var(--color-primary)]">⚡ Multi-gate confidence filter passed. Sport-specific risk gates cleared.</p>
          ) : (
            <p className="text-xs text-[color:var(--color-destructive)]">✗ Edge70 NOT detected — review reasoning below.</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">{a.ai_reasoning?.split("\n")[2] ?? ""}</p>
        </div>
      </div>

      <div className="border border-border bg-card rounded p-4">
        <div className="terminal-label mb-2">// Simulated probability curve</div>
        <MiniProbChart series={series} width={800} height={140} />
      </div>

      <DeepAnalyzePanel
        input={{
          sport: String(a.sport ?? "Other"),
          teamA: String(a.team_a ?? "A"),
          teamB: String(a.team_b ?? "B"),
          score: a.score ?? null,
          timePeriod: a.time_period ?? null,
          probabilityA: Number(a.probability_a ?? 50),
          probabilityB: Number(a.probability_b ?? 50),
          pattern: a.pattern_type ?? null,
          volume: a.volume != null ? Number(a.volume) : null,
          lastPlay: a.notes?.live ?? a.notes?.market ?? null,
          series,
        }}
      />


      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-border bg-card rounded p-4">
          <div className="terminal-label mb-2">// Pattern breakdown</div>
          <div className="text-lg font-bold mb-2">{a.pattern_type}</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {reasoning.map((r, i) => <li key={i}>→ {r}</li>)}
          </ul>
        </div>
        <div className="border border-border bg-card rounded p-4">
          <div className="terminal-label mb-2">// Recommended action</div>
          <div className="text-center py-6">
            <ActionBadge action={(a.recommended_action as ActionType) ?? "Watch Only"} className="text-base px-4 py-2" />
          </div>
          <div className="text-xs text-muted-foreground text-center">
            Based on edge score {Number(a.edge_score ?? 0).toFixed(1)}/10 and Edge70 {a.edge70_detected ? "active" : "inactive"}.
          </div>
        </div>
      </div>

      <Disclaimer />
      {open && <SaveBetModal analysis={a} userId={user?.id ?? ""} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SaveBetModal({ analysis, userId, onClose }: { analysis: any; userId: string; onClose: () => void }) {
  const [pick, setPick] = useState(analysis.predicted_winner ?? "");
  const [stake, setStake] = useState("100");
  const [odds, setOdds] = useState(String(analysis.odds_a ?? "1.5"));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("bets").insert({
      user_id: userId, analysis_id: analysis.id, game: `${analysis.team_a} vs ${analysis.team_b}`,
      sport: analysis.sport, pick, odds: Number(odds), stake: Number(stake),
      pattern_type: analysis.pattern_type, confidence_score: analysis.confidence_score,
      edge_score: analysis.edge_score, notes, result: "Pending", profit_loss: 0,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Added to backtest");
    onClose();
  };
  const cls = "w-full bg-background border border-border rounded px-2.5 py-1.5 text-sm font-mono";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md border border-border bg-card rounded p-5 space-y-3 font-mono">
        <h3 className="text-lg font-bold">Save to backtest</h3>
        <label className="block"><span className="terminal-label">Pick</span><input className={cls} value={pick} onChange={(e) => setPick(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="terminal-label">Stake</span><input type="number" className={cls} value={stake} onChange={(e) => setStake(e.target.value)} /></label>
          <label className="block"><span className="terminal-label">Odds</span><input type="number" step="0.01" className={cls} value={odds} onChange={(e) => setOdds(e.target.value)} /></label>
        </div>
        <label className="block"><span className="terminal-label">Notes</span><textarea rows={2} className={cls} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-border rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs uppercase tracking-wider border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
