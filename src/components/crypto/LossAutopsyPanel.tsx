// Read-only panel: shows loss autopsy tags from public.model_loss_autopsy.
// Zero impact on live trading — pure observation of tagged losses.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AutopsyRow {
  ticker: string;
  close_time: string;
  model_side: string;
  outcome: string;
  model_prob: number;
  edge_pts: number | null;
  strike_distance_pct: number | null;
  snapshot_seconds_to_close: number | null;
  flip_count: number | null;
  ta_score: number | null;
  chart_verdict: string | null;
  failure_tags: string[];
  primary_tag: string;
}

const TAG_STYLE: Record<string, string> = {
  high_conf_miss: "bg-red-500/20 border-red-500/40 text-red-300",
  near_strike_flip: "bg-amber-500/20 border-amber-500/40 text-amber-300",
  low_edge: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300",
  late_snapshot_only: "bg-orange-500/20 border-orange-500/40 text-orange-300",
  unstable_flips: "bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300",
  ta_disagreed: "bg-sky-500/20 border-sky-500/40 text-sky-300",
  chart_disagreed: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300",
  chop_reversal: "bg-violet-500/20 border-violet-500/40 text-violet-300",
  uncategorized: "bg-zinc-500/20 border-zinc-500/40 text-zinc-300",
};

function tagChip(tag: string) {
  return (
    <span
      key={tag}
      className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded border ${
        TAG_STYLE[tag] ?? TAG_STYLE.uncategorized
      }`}
    >
      {tag.replace(/_/g, " ")}
    </span>
  );
}

export function LossAutopsyPanel() {
  const q = useQuery({
    queryKey: ["loss-autopsy"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_loss_autopsy")
        .select("*")
        .order("close_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AutopsyRow[];
    },
    refetchInterval: 60_000,
  });

  const rows = q.data ?? [];

  const summary = rows.reduce<Record<string, number>>((acc, r) => {
    for (const t of r.failure_tags) acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  const summaryEntries = Object.entries(summary).sort((a, b) => b[1] - a[1]);

  return (
    <div className="border border-border bg-card rounded-lg p-4 space-y-3">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          // Loss Autopsy · read-only
        </div>
        <div className="text-sm text-muted-foreground mt-1">
          Every settled LOSS in the last 7 days, auto-tagged. Learning dataset —
          no live logic reads from this yet.
        </div>
      </div>

      {summaryEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
          {summaryEntries.map(([tag, n]) => (
            <span
              key={tag}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border ${
                TAG_STYLE[tag] ?? TAG_STYLE.uncategorized
              }`}
            >
              {tag.replace(/_/g, " ")} · {n}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-1 pr-3">Close (UTC)</th>
              <th className="text-left pr-3">Side→Out</th>
              <th className="text-right pr-3">Prob</th>
              <th className="text-right pr-3">Edge</th>
              <th className="text-right pr-3">Δstrike</th>
              <th className="text-right pr-3">t-left</th>
              <th className="text-right pr-3">flips</th>
              <th className="text-right pr-3">TA</th>
              <th className="text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={9} className="py-3 text-muted-foreground">loading…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="py-3 text-muted-foreground">no losses tagged yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.ticker} className="border-b border-border/40">
                <td className="py-1 pr-3 whitespace-nowrap">
                  {new Date(r.close_time).toISOString().slice(5, 16).replace("T", " ")}
                </td>
                <td className="pr-3">
                  <span className="text-muted-foreground">{r.model_side}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-red-400">{r.outcome}</span>
                </td>
                <td className="text-right pr-3">{(r.model_prob * 100).toFixed(1)}%</td>
                <td className="text-right pr-3">{r.edge_pts != null ? r.edge_pts.toFixed(1) : "—"}</td>
                <td className="text-right pr-3">
                  {r.strike_distance_pct != null ? `${r.strike_distance_pct.toFixed(3)}%` : "—"}
                </td>
                <td className="text-right pr-3">
                  {r.snapshot_seconds_to_close != null ? `${r.snapshot_seconds_to_close}s` : "—"}
                </td>
                <td className="text-right pr-3">{r.flip_count ?? 0}</td>
                <td className="text-right pr-3">{r.ta_score != null ? r.ta_score.toFixed(0) : "—"}</td>
                <td className="py-1">
                  <div className="flex flex-wrap gap-1">
                    {(r.failure_tags.length > 0 ? r.failure_tags : [r.primary_tag]).map(tagChip)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
