import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { VerdictLogTab } from "@/components/edge/VerdictLogTab";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "P&L / History — EdgeGraph AI" },
      { name: "description", content: "All your bets, cashout alerts, and past analyses in one place." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { user } = useAuth();

  const analysesQ = useQuery({
    queryKey: ["analyses-history", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("id, created_at, sport, game_name, team_a, team_b, predicted_winner, edge_score, confidence_score, recommended_action")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!user,
  });

  const analyses = analysesQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <History className="h-5 w-5 text-[color:var(--color-primary)]" />
        <div>
          <h1 className="text-xl font-bold tracking-widest uppercase">P&amp;L / History</h1>
          <p className="text-xs text-muted-foreground">
            Your bet log, live cashout alerts, and past analyses — all in one place.
          </p>
        </div>
      </div>

      {/* Bets + cashout alerts (reuses existing component) */}
      <VerdictLogTab />

      {/* Analyses history */}
      <section className="border border-border rounded-lg bg-card">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="terminal-label">// Past analyses</h2>
          <span className="text-xs text-muted-foreground">{analyses.length} total</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider">
              <tr className="border-b border-border">
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Sport</th>
                <th className="text-left p-3">Matchup</th>
                <th className="text-left p-3">Pick</th>
                <th className="text-right p-3">Edge</th>
                <th className="text-right p-3">Conf.</th>
                <th className="text-left p-3">Action</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {analysesQ.isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!analysesQ.isLoading && analyses.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No analyses yet. <Link to="/analyze" className="text-[color:var(--color-primary)] underline">Run your first one →</Link>
                  </td>
                </tr>
              )}
              {analyses.map((a) => {
                const matchup = a.game_name || [a.team_a, a.team_b].filter(Boolean).join(" vs ") || "—";
                const edge = a.edge_score == null ? null : Number(a.edge_score);
                const conf = a.confidence_score == null ? null : Number(a.confidence_score);
                return (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-3 text-muted-foreground font-mono">
                      {new Date(a.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-3">{a.sport ?? "—"}</td>
                    <td className="p-3">{matchup}</td>
                    <td className="p-3">{a.predicted_winner ?? "—"}</td>
                    <td className={`p-3 text-right font-mono ${edge != null && edge >= 5 ? "text-emerald-400" : ""}`}>
                      {edge != null ? `${edge.toFixed(1)}` : "—"}
                    </td>
                    <td className="p-3 text-right font-mono">{conf != null ? `${conf.toFixed(0)}%` : "—"}</td>
                    <td className="p-3 text-muted-foreground">{a.recommended_action ?? "—"}</td>
                    <td className="p-3 text-right">
                      <Link
                        to="/analysis/$id"
                        params={{ id: a.id }}
                        className="text-[color:var(--color-primary)] underline text-[10px] uppercase tracking-wider"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
