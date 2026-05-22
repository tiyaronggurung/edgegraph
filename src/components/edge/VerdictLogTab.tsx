import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { StatCard } from "@/components/edge/StatCard";
import { Check, X, Minus, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  created_at: string;
  market_ticker: string;
  market_title: string | null;
  side: string;
  side_label: string | null;
  fair_prob: number | null;
  market_prob: number | null;
  edge_pts: number | null;
  pattern: string | null;
  kelly_half: number | null;
  verdict: string;
  result: string;
  resolved_at: string | null;
};

const RESULT_FILTERS = ["All", "Pending", "WIN", "LOSS", "VOID"] as const;
type ResultFilter = (typeof RESULT_FILTERS)[number];

export function VerdictLogTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ResultFilter>("All");
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["verdict-log", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("verdict_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    enabled: !!user,
  });

  const rows = q.data ?? [];

  const filtered = useMemo(
    () => (filter === "All" ? rows : rows.filter((r) => r.result === filter)),
    [rows, filter],
  );

  const stats = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.result === "Pending").length;
    const wins = rows.filter((r) => r.result === "WIN").length;
    const losses = rows.filter((r) => r.result === "LOSS").length;
    const decided = wins + losses;
    const hitRate = decided > 0 ? wins / decided : 0;
    return { total, pending, wins, losses, hitRate };
  }, [rows]);

  async function setResult(id: string, result: "WIN" | "LOSS" | "VOID" | "Pending") {
    setBusyId(id);
    const patch =
      result === "Pending"
        ? { result, resolved_at: null }
        : { result, resolved_at: new Date().toISOString() };
    const { error } = await supabase.from("verdict_log").update(patch).eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error(`Failed to update: ${error.message}`);
      return;
    }
    qc.invalidateQueries({ queryKey: ["verdict-log", user?.id] });
  }

  if (!user) {
    return (
      <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
        Sign in to track verdicts.
      </div>
    );
  }

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading verdict log…</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Every BET verdict shown on /live is auto-logged here. Mark each one WIN / LOSS / VOID
        when the game ends to track whether the analytics actually called it right.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Tracked" value={stats.total.toLocaleString()} accent="info" />
        <StatCard label="Pending" value={stats.pending.toLocaleString()} accent="warning" />
        <StatCard label="Wins" value={stats.wins.toLocaleString()} accent="primary" />
        <StatCard label="Losses" value={stats.losses.toLocaleString()} accent="danger" />
        <StatCard
          label="Hit rate"
          value={`${(stats.hitRate * 100).toFixed(1)}%`}
          accent={stats.hitRate >= 0.5 ? "primary" : "danger"}
          sub={`${stats.wins}/${stats.wins + stats.losses} decided`}
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {RESULT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
              filter === f
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No verdicts logged yet. Open /live and let a BET verdict appear — it logs automatically."
            : "No rows match this filter."}
        </div>
      ) : (
        <section className="border border-border bg-card rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground uppercase tracking-widest text-[10px]">
                <tr>
                  <th className="text-left p-2">Logged</th>
                  <th className="text-left p-2">Market</th>
                  <th className="text-left p-2">Side</th>
                  <th className="text-right p-2">Fair</th>
                  <th className="text-right p-2">Market</th>
                  <th className="text-right p-2">Edge</th>
                  <th className="text-left p-2">Pattern</th>
                  <th className="text-right p-2">½K</th>
                  <th className="text-center p-2">Result</th>
                  <th className="text-right p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const tone =
                    r.result === "WIN"
                      ? "text-emerald-400"
                      : r.result === "LOSS"
                        ? "text-red-400"
                        : r.result === "VOID"
                          ? "text-muted-foreground"
                          : "text-amber-400";
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-2 max-w-[200px]">
                        <div className="truncate font-medium">{r.market_title ?? r.market_ticker}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {r.market_ticker}
                        </div>
                      </td>
                      <td className="p-2">{r.side_label ?? r.side}</td>
                      <td className="p-2 text-right tabular-nums">
                        {r.fair_prob != null ? `${Number(r.fair_prob).toFixed(0)}%` : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">
                        {r.market_prob != null ? `${Number(r.market_prob).toFixed(0)}%` : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {r.edge_pts != null ? `+${Number(r.edge_pts).toFixed(1)}` : "—"}
                      </td>
                      <td className="p-2 text-muted-foreground">{r.pattern ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">
                        {r.kelly_half != null ? `$${Number(r.kelly_half).toFixed(0)}` : "—"}
                      </td>
                      <td className={`p-2 text-center font-bold uppercase tracking-widest ${tone}`}>
                        {r.result}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-end">
                          {busyId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : r.result === "Pending" ? (
                            <>
                              <button
                                onClick={() => setResult(r.id, "WIN")}
                                title="Mark WIN"
                                className="p-1 rounded border border-border hover:border-emerald-500 hover:text-emerald-400"
                              >
                                <Check className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setResult(r.id, "LOSS")}
                                title="Mark LOSS"
                                className="p-1 rounded border border-border hover:border-red-500 hover:text-red-400"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setResult(r.id, "VOID")}
                                title="Mark VOID"
                                className="p-1 rounded border border-border hover:border-muted-foreground hover:text-muted-foreground"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setResult(r.id, "Pending")}
                              title="Reset to Pending"
                              className="text-[10px] text-muted-foreground hover:text-foreground underline"
                            >
                              undo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
