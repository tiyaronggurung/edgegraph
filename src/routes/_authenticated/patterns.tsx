import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { MiniProbChart } from "@/components/edge/MiniProbChart";
import { RiskBadge } from "@/components/edge/RiskBadge";
import { generateSimulatedSeries, type Pattern, type Risk } from "@/lib/analysisEngine";

export const Route = createFileRoute("/_authenticated/patterns")({
  head: () => ({ meta: [{ title: "Pattern Library — EdgeGraph AI" }] }),
  component: Patterns,
});

const RISKS = ["All", "Low", "Medium", "High"] as const;

function Patterns() {
  const [filter, setFilter] = useState<(typeof RISKS)[number]>("All");
  const q = useQuery({
    queryKey: ["patterns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("patterns").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const patterns = (q.data ?? []).filter((p) =>
    filter === "All" ? true : p.risk_level.toLowerCase().startsWith(filter.toLowerCase()),
  );

  return (
    <div className="space-y-5 font-mono">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider">// Pattern Library</h1>
        <p className="text-xs text-muted-foreground">14 market patterns the engine can detect.</p>
      </div>
      <div className="flex gap-2">
        {RISKS.map((r) => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
              filter === r
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-border text-muted-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {patterns.map((p) => (
          <div key={p.id} className="border border-border bg-card rounded p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-bold text-sm flex items-center gap-2"><span>{p.icon}</span>{p.name}</div>
              <RiskBadge risk={p.risk_level as Risk} />
            </div>
            <MiniProbChart series={generateSimulatedSeries(p.name as Pattern, 80)} width={280} height={64} />
            <p className="text-xs text-muted-foreground">{p.description}</p>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Best use</div>
            <div className="text-xs">{p.best_use}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Condition</div>
            <div className="text-xs font-mono">{p.condition_logic}</div>
            <div className="pt-1 text-xs text-[color:var(--color-primary)]">→ {p.recommended_action}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
