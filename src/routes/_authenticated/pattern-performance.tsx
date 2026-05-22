import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { StatCard } from "@/components/edge/StatCard";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { VerdictLogTab } from "@/components/edge/VerdictLogTab";
import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";

export const Route = createFileRoute("/_authenticated/pattern-performance")({
  head: () => ({ meta: [{ title: "Pattern Performance — EdgeGraph AI" }] }),
  component: PatternPerformance,
});

type BetRow = {
  pattern_type: string | null;
  result: string | null;
  profit_loss: number | null;
  stake: number | null;
  confidence_score: number | null;
  edge_score: number | null;
  clv_percent: number | null;
  sport: string | null;
};

type Group = {
  pattern: string;
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  totalStake: number;
  totalPnl: number;
  hitRate: number;       // 0–1, excludes pushes
  roi: number;           // pnl / stake
  avgConfidence: number;
  avgEdge: number;
  avgClv: number | null; // only over rows with clv_percent
  clvCount: number;
};

const MIN_SAMPLE_TRUST = 20;

function PatternPerformance() {
  const { user } = useAuth();
  const [sport, setSport] = useState("All");
  const [minN, setMinN] = useState(1);
  const [tab, setTab] = useState<"patterns" | "verdicts">("patterns");

  const q = useQuery({
    queryKey: ["pattern-performance", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bets")
        .select(
          "pattern_type, result, profit_loss, stake, confidence_score, edge_score, clv_percent, sport"
        )
        .in("result", ["Win", "Loss", "Push"])
        .not("pattern_type", "is", null)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as BetRow[];
    },
  });

  const sports = useMemo(() => {
    const s = new Set<string>(["All"]);
    for (const b of q.data ?? []) if (b.sport) s.add(b.sport);
    return Array.from(s);
  }, [q.data]);

  const filtered = useMemo(() => {
    const rows = q.data ?? [];
    return rows.filter((r) => (sport === "All" ? true : r.sport === sport));
  }, [q.data, sport]);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of filtered) {
      const key = r.pattern_type || "Unknown";
      let g = map.get(key);
      if (!g) {
        g = {
          pattern: key,
          n: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          totalStake: 0,
          totalPnl: 0,
          hitRate: 0,
          roi: 0,
          avgConfidence: 0,
          avgEdge: 0,
          avgClv: null,
          clvCount: 0,
        };
        map.set(key, g);
      }
      g.n += 1;
      if (r.result === "Win") g.wins += 1;
      else if (r.result === "Loss") g.losses += 1;
      else if (r.result === "Push") g.pushes += 1;
      g.totalStake += Number(r.stake ?? 0);
      g.totalPnl += Number(r.profit_loss ?? 0);
      g.avgConfidence += Number(r.confidence_score ?? 0);
      g.avgEdge += Number(r.edge_score ?? 0);
      if (r.clv_percent != null) {
        g.avgClv = (g.avgClv ?? 0) + Number(r.clv_percent);
        g.clvCount += 1;
      }
    }
    const out = Array.from(map.values()).map((g) => {
      const decided = g.wins + g.losses;
      g.hitRate = decided > 0 ? g.wins / decided : 0;
      g.roi = g.totalStake > 0 ? g.totalPnl / g.totalStake : 0;
      g.avgConfidence = g.n > 0 ? g.avgConfidence / g.n : 0;
      g.avgEdge = g.n > 0 ? g.avgEdge / g.n : 0;
      g.avgClv = g.clvCount > 0 ? (g.avgClv as number) / g.clvCount : null;
      return g;
    });
    return out.filter((g) => g.n >= minN).sort((a, b) => b.roi - a.roi);
  }, [filtered, minN]);

  const totals = useMemo(() => {
    const n = filtered.length;
    const decided = filtered.filter((r) => r.result === "Win" || r.result === "Loss").length;
    const wins = filtered.filter((r) => r.result === "Win").length;
    const stake = filtered.reduce((s, r) => s + Number(r.stake ?? 0), 0);
    const pnl = filtered.reduce((s, r) => s + Number(r.profit_loss ?? 0), 0);
    return {
      n,
      hitRate: decided ? wins / decided : 0,
      roi: stake ? pnl / stake : 0,
      pnl,
      patterns: groups.length,
    };
  }, [filtered, groups.length]);

  if (q.isLoading) {
    return <div className="max-w-7xl mx-auto p-6 text-muted-foreground text-sm">Loading…</div>;
  }
  if (q.isError) {
    return (
      <div className="max-w-7xl mx-auto p-6 text-sm text-[color:var(--color-destructive)]">
        Failed to load bets: {(q.error as Error).message}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold neon-text tracking-wide">PATTERN PERFORMANCE</h1>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Group every settled bet by the pattern detected at decision time. Which patterns
          actually print? ROI is the only number that matters long-run — hit rate without ROI
          can lie when payouts are uneven. Below {MIN_SAMPLE_TRUST} bets per pattern, treat
          numbers as noise.
        </p>
      </header>

      <div className="flex gap-2 border-b border-border">
        {[
          { k: "patterns", label: "Pattern ROI" },
          { k: "verdicts", label: "Verdict Log" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as "patterns" | "verdicts")}
            className={`px-4 py-2 text-xs uppercase tracking-widest border-b-2 -mb-px transition-colors ${
              tab === t.k
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "verdicts" ? (
        <>
          <VerdictLogTab />
          <Disclaimer />
        </>
      ) : (
        <PatternsView
          sport={sport}
          setSport={setSport}
          minN={minN}
          setMinN={setMinN}
          sports={sports}
          totals={totals}
          groups={groups}
        />
      )}
    </div>
  );
}

type PatternsViewProps = {
  sport: string;
  setSport: (s: string) => void;
  minN: number;
  setMinN: (n: number) => void;
  sports: string[];
  totals: { n: number; hitRate: number; roi: number; pnl: number; patterns: number };
  groups: Group[];
};

function PatternsView({ sport, setSport, minN, setMinN, sports, totals, groups }: PatternsViewProps) {
  return (
    <>


      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="terminal-label">Sport</span>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="bg-card border border-border rounded px-2 py-1.5 min-w-[120px]"
          >
            {sports.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="terminal-label">Min sample (n)</span>
          <input
            type="number"
            min={1}
            value={minN}
            onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))}
            className="bg-card border border-border rounded px-2 py-1.5 w-20"
          />
        </label>
        <Link
          to="/model-validation"
          className="ml-auto text-[color:var(--color-primary)] underline self-end pb-1"
        >
          → Model calibration
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Settled bets" value={totals.n.toLocaleString()} accent="info" />
        <StatCard label="Patterns" value={totals.patterns.toLocaleString()} accent="info" />
        <StatCard
          label="Hit rate"
          value={`${(totals.hitRate * 100).toFixed(1)}%`}
          accent="primary"
        />
        <StatCard
          label="ROI"
          value={`${(totals.roi * 100).toFixed(1)}%`}
          accent={totals.roi >= 0 ? "primary" : "danger"}
          sub={`P/L $${totals.pnl.toFixed(2)}`}
        />
        <StatCard
          label="P/L"
          value={`$${totals.pnl.toFixed(2)}`}
          accent={totals.pnl >= 0 ? "primary" : "danger"}
        />
      </div>

      {totals.n < MIN_SAMPLE_TRUST && totals.n > 0 && (
        <div className="text-[11px] text-[color:var(--color-warning)] border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/5 rounded p-3">
          Low total sample ({totals.n}). Pattern-level numbers below are very noisy — log more
          settled bets before drawing conclusions.
        </div>
      )}

      {groups.length === 0 ? (
        <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
          No settled bets with a pattern tag yet. Save bets from the Live or Analyze page and
          mark them Win / Loss in the Dashboard to populate this view.
        </div>
      ) : (
        <>
          <section className="border border-border bg-card rounded p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="terminal-label">ROI by pattern</h2>
              <span className="text-[10px] text-muted-foreground">green &gt; 0 · red &lt; 0</span>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={groups.map((g) => ({
                    name: g.pattern,
                    roi: Number((g.roi * 100).toFixed(2)),
                    n: g.n,
                  }))}
                  margin={{ top: 10, right: 12, bottom: 24, left: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => `${v}%`}
                    width={48}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      fontSize: 12,
                    }}
                    formatter={(v: number, _k, p) =>
                      [`${v.toFixed(2)}%`, `ROI (n=${p.payload.n})`]
                    }
                  />
                  <Bar dataKey="roi" radius={[4, 4, 0, 0]}>
                    {groups.map((g) => (
                      <Cell
                        key={g.pattern}
                        fill={
                          g.n < MIN_SAMPLE_TRUST
                            ? "hsl(var(--muted-foreground) / 0.5)"
                            : g.roi >= 0
                            ? "hsl(var(--primary))"
                            : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Faded bars = under {MIN_SAMPLE_TRUST} bets (low trust). Sort by ROI to find your
              most profitable patterns; ignore narrow gaps when n is small.
            </p>
          </section>

          <section className="border border-border bg-card rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground uppercase tracking-widest text-[10px]">
                  <tr>
                    <th className="text-left p-2">Pattern</th>
                    <th className="text-right p-2">n</th>
                    <th className="text-right p-2">W-L-P</th>
                    <th className="text-right p-2">Hit %</th>
                    <th className="text-right p-2">ROI %</th>
                    <th className="text-right p-2">P/L</th>
                    <th className="text-right p-2">Stake</th>
                    <th className="text-right p-2">Avg conf</th>
                    <th className="text-right p-2">Avg edge</th>
                    <th className="text-right p-2">Avg CLV %</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const trusted = g.n >= MIN_SAMPLE_TRUST;
                    const roiClass =
                      g.roi >= 0
                        ? "text-[color:var(--color-primary)]"
                        : "text-[color:var(--color-destructive)]";
                    return (
                      <tr
                        key={g.pattern}
                        className="border-t border-border hover:bg-muted/20"
                      >
                        <td className="p-2 font-medium">
                          {g.pattern}{" "}
                          {!trusted && (
                            <span className="text-[9px] text-muted-foreground ml-1">
                              (low-n)
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">{g.n}</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {g.wins}-{g.losses}-{g.pushes}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {(g.hitRate * 100).toFixed(1)}%
                        </td>
                        <td className={`p-2 text-right tabular-nums font-bold ${roiClass}`}>
                          {(g.roi * 100).toFixed(1)}%
                        </td>
                        <td className={`p-2 text-right tabular-nums ${roiClass}`}>
                          ${g.totalPnl.toFixed(2)}
                        </td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          ${g.totalStake.toFixed(2)}
                        </td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {g.avgConfidence.toFixed(0)}
                        </td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {g.avgEdge.toFixed(1)}
                        </td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {g.avgClv != null
                            ? `${g.avgClv >= 0 ? "+" : ""}${g.avgClv.toFixed(2)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <Disclaimer />
    </>
  );
}

