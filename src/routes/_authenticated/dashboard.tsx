import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { StatCard } from "@/components/edge/StatCard";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { ActionBadge } from "@/components/edge/ActionBadge";
import { sportIcon, SPORTS } from "@/lib/sports";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { toast } from "sonner";
import { useState } from "react";
import type { ActionType } from "@/lib/analysisEngine";
import { ClvLedger } from "@/components/edge/ClvLedger";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — EdgeGraph AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const [seeding, setSeeding] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickAmount, setQuickAmount] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  const submitQuickLog = async () => {
    if (!user) return;
    const amt = Number(quickAmount);
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error("Enter a non-zero amount (negative for losses)");
      return;
    }
    setQuickSaving(true);
    try {
      const { error } = await supabase.from("bets").insert({
        user_id: user.id,
        game: "Quick log",
        pick: quickNote || "Quick P/L entry",
        sport: "Other",
        stake: 0,
        odds: 0,
        result: amt >= 0 ? "Win" : "Loss",
        profit_loss: amt,
        notes: quickNote || null,
      });
      if (error) throw error;
      toast.success(`Logged ${amt >= 0 ? "+" : ""}$${amt.toFixed(2)}`);
      setQuickAmount("");
      setQuickNote("");
      setQuickOpen(false);
      betsQ.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setQuickSaving(false);
    }
  };

  const analysesQ = useQuery({
    queryKey: ["analyses", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const betsQ = useQuery({
    queryKey: ["bets", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("bets").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data;
    },
  });

  const analyses = analysesQ.data ?? [];
  const bets = betsQ.data ?? [];

  const settled = bets.filter((b) => b.result === "Win" || b.result === "Loss");
  const wins = settled.filter((b) => b.result === "Win");
  const winRate = settled.length ? (wins.length / settled.length) * 100 : 0;
  const totalPL = bets.reduce((s, b) => s + Number(b.profit_loss ?? 0), 0);
  const totalStake = settled.reduce((s, b) => s + Number(b.stake ?? 0), 0);
  const roi = totalStake ? (totalPL / totalStake) * 100 : 0;
  const avgConf =
    analyses.length ? analyses.reduce((s, a) => s + Number(a.confidence_score ?? 0), 0) / analyses.length : 0;
  const edge70Count = analyses.filter((a) => a.edge70_detected).length;

  const patternWinRates: Record<string, { wins: number; total: number }> = {};
  for (const b of settled) {
    const p = b.pattern_type ?? "Unknown";
    patternWinRates[p] ??= { wins: 0, total: 0 };
    patternWinRates[p].total += 1;
    if (b.result === "Win") patternWinRates[p].wins += 1;
  }
  const bestPattern = Object.entries(patternWinRates)
    .filter(([, v]) => v.total >= 1)
    .sort(([, a], [, b]) => b.wins / b.total - a.wins / a.total)[0]?.[0] ?? "—";

  const plBySport = SPORTS.map((s) => ({
    sport: s.key,
    pl: bets.filter((b) => b.sport === s.key).reduce((sum, b) => sum + Number(b.profit_loss ?? 0), 0),
  }));

  const winRateData = Object.entries(patternWinRates).map(([name, v]) => ({
    name,
    rate: v.total ? (v.wins / v.total) * 100 : 0,
  }));

  const recent = analyses.slice(0, 8);

  const seedDemo = async () => {
    if (!user) return;
    setSeeding(true);
    try {
      const demoAnalyses = [
        { sport: "NBA", team_a: "Lakers", team_b: "Celtics", score: "102-99", time_period: "Q4 4:12",
          probability_a: 87, probability_b: 13, odds_a: 1.15, odds_b: 6.5, volume: 12500,
          pattern_type: "Late-Game Stability", predicted_winner: "Lakers", confidence_score: 87, edge_score: 7.8,
          risk_level: "Low", recommended_action: "Bet", edge70_detected: true, ai_reasoning: "Stable Q4 lead with no foul trouble." },
        { sport: "NFL", team_a: "Chiefs", team_b: "Bills", score: "27-20", time_period: "Q4 6:20",
          probability_a: 81, probability_b: 19, odds_a: 1.25, odds_b: 4.2, volume: 22100,
          pattern_type: "Controlled Stability", predicted_winner: "Chiefs", confidence_score: 81, edge_score: 7.1,
          risk_level: "Low", recommended_action: "Bet", edge70_detected: true, ai_reasoning: "Steady probability climb with timeouts in pocket." },
        { sport: "NHL", team_a: "Bruins", team_b: "Rangers", score: "3-2", time_period: "P3 8:45",
          probability_a: 79, probability_b: 21, odds_a: 1.3, odds_b: 3.8, volume: 8200,
          pattern_type: "Sharp Money Recovery", predicted_winner: "Bruins", confidence_score: 79, edge_score: 6.4,
          risk_level: "Medium", recommended_action: "Wait", edge70_detected: true, ai_reasoning: "Quiet recovery after panic dip." },
        { sport: "Tennis", team_a: "Sabalenka", team_b: "Swiatek", score: "1-1", time_period: "Set 2 TB",
          probability_a: 51, probability_b: 49, odds_a: 2.0, odds_b: 1.95, volume: 4500,
          pattern_type: "Chaotic Coin Flip", predicted_winner: "Sabalenka", confidence_score: 51, edge_score: 0.8,
          risk_level: "High", recommended_action: "Avoid", edge70_detected: false, ai_reasoning: "Active tiebreak — Edge70 blocked." },
        { sport: "Soccer", team_a: "Man City", team_b: "Arsenal", score: "2-1", time_period: "82'",
          probability_a: 76, probability_b: 24, odds_a: 1.4, odds_b: 3.5, volume: 18900,
          pattern_type: "Late Momentum Swing", predicted_winner: "Man City", confidence_score: 76, edge_score: 6.0,
          risk_level: "Medium", recommended_action: "Wait", edge70_detected: true, ai_reasoning: "Minute 82 lead — gates pass." },
      ].map((x) => ({ ...x, user_id: user.id }));
      const { data: aRows, error: aErr } = await supabase.from("analyses").insert(demoAnalyses).select();
      if (aErr) throw aErr;

      const demoBets = [
        { game: "Lakers vs Celtics", sport: "NBA", pick: "Lakers ML", odds: 1.15, stake: 100, pattern_type: "Late-Game Stability", confidence_score: 87, edge_score: 7.8, result: "Win", profit_loss: 15, analysis_id: aRows?.[0]?.id ?? null },
        { game: "Chiefs vs Bills", sport: "NFL", pick: "Chiefs -3", odds: 1.9, stake: 100, pattern_type: "Controlled Stability", confidence_score: 81, edge_score: 7.1, result: "Win", profit_loss: 90, analysis_id: aRows?.[1]?.id ?? null },
        { game: "Bruins vs Rangers", sport: "NHL", pick: "Bruins ML", odds: 1.3, stake: 50, pattern_type: "Sharp Money Recovery", confidence_score: 79, edge_score: 6.4, result: "Loss", profit_loss: -50, analysis_id: aRows?.[2]?.id ?? null },
        { game: "Yankees vs Dodgers", sport: "MLB", pick: "Yankees ML", odds: 1.5, stake: 75, pattern_type: "Late Momentum Swing", confidence_score: 84, edge_score: 7.6, result: "Win", profit_loss: 37.5 },
        { game: "Man City vs Arsenal", sport: "Soccer", pick: "Man City", odds: 1.4, stake: 100, pattern_type: "Late Momentum Swing", confidence_score: 76, edge_score: 6.0, result: "Win", profit_loss: 40, analysis_id: aRows?.[4]?.id ?? null },
      ].map((x) => ({ ...x, user_id: user.id }));
      const { error: bErr } = await supabase.from("bets").insert(demoBets);
      if (bErr) throw bErr;

      const demoStrategies = [
        { name: "Lock & Hold", rules: "Only bet Dominant Lock patterns with Edge70 active in last 5 minutes.", pattern_type: "Dominant Lock", minimum_confidence: 88, recommended_action: "Bet", active: true },
        { name: "Sharp Fade", rules: "After public overreaction, wait for sharp money recovery before entering.", pattern_type: "Sharp Money Recovery", minimum_confidence: 75, recommended_action: "Wait", active: true },
        { name: "Avoid Volatility", rules: "Skip Chaotic Coin Flip and Fake Spike patterns entirely.", pattern_type: "Chaotic Coin Flip", minimum_confidence: 0, recommended_action: "Avoid", active: false },
      ].map((x) => ({ ...x, user_id: user.id }));
      const { error: sErr } = await supabase.from("strategies").insert(demoStrategies);
      if (sErr) throw sErr;

      toast.success("Demo data loaded");
      analysesQ.refetch();
      betsQ.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">// Terminal</h1>
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="text-[color:var(--color-primary)]">{user?.email}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {analyses.length === 0 && (
            <button
              onClick={seedDemo}
              disabled={seeding}
              className="text-xs uppercase tracking-wider px-3 py-2 border border-border rounded hover:border-[color:var(--color-info)] hover:text-[color:var(--color-info)]"
            >
              {seeding ? "Loading…" : "+ Load demo data"}
            </button>
          )}
          <Link
            to="/analyze"
            className="text-xs uppercase tracking-wider px-3 py-2 border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
          >
            ⚡ New analysis
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Analyzed Games" value={analyses.length} sub="all-time" />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} accent={winRate >= 50 ? "primary" : "danger"} sub={`${wins.length}/${settled.length} settled`} />
        <StatCard label="Avg Confidence" value={`${avgConf.toFixed(1)}%`} accent="info" />
        <StatCard label="Edge70 Signals" value={edge70Count} accent="primary" sub="detected" />
        <StatCard label="Total P&L" value={`$${totalPL.toFixed(2)}`} accent={totalPL >= 0 ? "primary" : "danger"} />
        <StatCard label="ROI" value={`${roi.toFixed(1)}%`} accent={roi >= 0 ? "primary" : "danger"} />
        <StatCard label="Bankroll" value={`$${Number(profileQ.data?.bankroll ?? 0).toFixed(0)}`} accent="info" />
        <StatCard label="Best Pattern" value={<span className="text-sm">{bestPattern}</span>} accent="primary" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-border bg-card rounded p-4">
          <h2 className="terminal-label mb-3">// P&L by sport</h2>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={plBySport}>
                <XAxis dataKey="sport" stroke="var(--color-muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Bar dataKey="pl">
                  {plBySport.map((d, i) => (
                    <Cell key={i} fill={d.pl >= 0 ? "var(--color-primary)" : "var(--color-destructive)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-border bg-card rounded p-4">
          <h2 className="terminal-label mb-3">// Win rate by pattern</h2>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={winRateData} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={10} domain={[0, 100]} />
                <YAxis dataKey="name" type="category" stroke="var(--color-muted-foreground)" fontSize={10} width={120} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Bar dataKey="rate" fill="var(--color-primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!winRateData.length && (
            <p className="text-xs text-muted-foreground text-center pt-4">No settled bets yet.</p>
          )}
        </div>
      </div>

      <div className="border border-border bg-card rounded">
        <div className="p-4 border-b border-border flex justify-between items-center">
          <h2 className="terminal-label">// Recent analyses</h2>
          <Link to="/analyze" className="text-xs uppercase tracking-wider text-[color:var(--color-primary)] hover:underline">
            + New
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider">
              <tr className="border-b border-border">
                <th className="text-left p-3">Sport</th>
                <th className="text-left p-3">Game</th>
                <th className="text-left p-3">Pattern</th>
                <th className="text-right p-3">Conf</th>
                <th className="text-right p-3">Edge</th>
                <th className="text-left p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => (
                <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-3">{sportIcon(a.sport)} {a.sport}</td>
                  <td className="p-3">
                    <Link to="/analysis/$id" params={{ id: a.id }} className="hover:text-[color:var(--color-primary)]">
                      {a.team_a} vs {a.team_b}
                    </Link>
                  </td>
                  <td className="p-3"><PatternBadge pattern={a.pattern_type ?? "—"} /></td>
                  <td className="p-3 text-right tabular-nums">{a.confidence_score}%</td>
                  <td className="p-3 text-right tabular-nums">{Number(a.edge_score ?? 0).toFixed(1)}</td>
                  <td className="p-3"><ActionBadge action={(a.recommended_action as ActionType) ?? "Watch Only"} /></td>
                </tr>
              ))}
              {!recent.length && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No analyses yet. Run your first one or load demo data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClvLedger />
    </div>
  );
}
