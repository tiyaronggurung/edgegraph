import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { StatCard } from "@/components/edge/StatCard";
import { Disclaimer } from "@/components/edge/Disclaimer";
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
  LineChart,
  Line,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/model-validation")({
  head: () => ({ meta: [{ title: "Model Validation — EdgeGraph AI" }] }),
  component: ModelValidation,
});

type Row = {
  predicted: number; // model probability for the team we picked (0–1)
  outcome: 0 | 1;    // 1 = pick won, 0 = lost
  confidence: number | null;
  sport: string | null;
  date: string;
};

function ModelValidation() {
  const { user } = useAuth();
  const [minConf, setMinConf] = useState(0);
  const [sport, setSport] = useState("All");

  const q = useQuery({
    queryKey: ["model-validation", user?.id],
    queryFn: async () => {
      // Pull every settled bet linked to an analysis. The analysis stores the
      // model probabilities at decision time — exactly what we want to score.
      const { data, error } = await supabase
        .from("bets")
        .select(
          "id, result, sport, pick, date, confidence_score, analysis_id, analyses!inner(probability_a, probability_b, team_a, team_b, predicted_winner)"
        )
        .in("result", ["Win", "Loss"])
        .not("analysis_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows: Row[] = useMemo(() => {
    const raw = q.data ?? [];
    const out: Row[] = [];
    for (const b of raw as any[]) {
      const a = b.analyses;
      if (!a) continue;
      // Map predicted probability to the team the bet was on.
      // bets.pick is free text — match against team_a / team_b names.
      const pick = String(b.pick ?? "").toLowerCase();
      const ta = String(a.team_a ?? "").toLowerCase();
      const tb = String(a.team_b ?? "").toLowerCase();
      let pred: number | null = null;
      if (ta && pick.includes(ta)) pred = Number(a.probability_a);
      else if (tb && pick.includes(tb)) pred = Number(a.probability_b);
      else {
        // Fallback: use predicted_winner side.
        const pw = String(a.predicted_winner ?? "").toLowerCase();
        if (pw === ta) pred = Number(a.probability_a);
        else if (pw === tb) pred = Number(a.probability_b);
      }
      if (pred == null || !Number.isFinite(pred)) continue;
      const p = pred > 1 ? pred / 100 : pred; // accept 0–100 or 0–1
      out.push({
        predicted: Math.min(Math.max(p, 0.01), 0.99),
        outcome: b.result === "Win" ? 1 : 0,
        confidence: b.confidence_score == null ? null : Number(b.confidence_score),
        sport: b.sport,
        date: String(b.date),
      });
    }
    return out;
  }, [q.data]);

  const filtered = rows.filter(
    (r) =>
      (sport === "All" || r.sport === sport) &&
      (r.confidence == null ? true : r.confidence >= minConf)
  );

  const stats = useMemo(() => computeMetrics(filtered), [filtered]);
  const calibration = useMemo(() => calibrationBuckets(filtered), [filtered]);
  const confBands = useMemo(() => confidenceBands(filtered), [filtered]);

  const sports = ["All", ...Array.from(new Set(rows.map((r) => r.sport).filter(Boolean) as string[]))];

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">// Model validation</h1>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Replays the model against every settled bet linked to an analysis.
            Brier &lt; 0.25 means the model beats coin-flip; calibration shows
            whether predicted prob matches actual hit rate. This is the only
            scoreboard that matters before sample size is large enough for ROI
            to mean anything.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 uppercase tracking-wider"
          >
            {sports.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 border border-border rounded px-2 py-1">
            <span className="text-muted-foreground uppercase tracking-wider">Min conf</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minConf}
              onChange={(e) => setMinConf(Number(e.target.value))}
              className="w-12 bg-transparent text-right tabular-nums"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Sample Size"
          value={filtered.length}
          sub={`of ${rows.length} settled`}
          accent="info"
        />
        <StatCard
          label="Brier Score"
          value={stats.brier == null ? "—" : stats.brier.toFixed(4)}
          accent={stats.brier == null ? "muted" : stats.brier < 0.25 ? "primary" : "danger"}
          sub={brierLabel(stats.brier)}
        />
        <StatCard
          label="Log Loss"
          value={stats.logLoss == null ? "—" : stats.logLoss.toFixed(4)}
          accent={stats.logLoss == null ? "muted" : stats.logLoss < 0.693 ? "primary" : "danger"}
          sub="lower = better"
        />
        <StatCard
          label="Accuracy"
          value={stats.accuracy == null ? "—" : `${(stats.accuracy * 100).toFixed(1)}%`}
          accent={stats.accuracy != null && stats.accuracy >= 0.55 ? "primary" : "danger"}
          sub={`pred avg ${stats.avgPred == null ? "—" : (stats.avgPred * 100).toFixed(1)}%`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-border bg-card rounded p-4">
          <h2 className="terminal-label mb-1">// Calibration plot</h2>
          <p className="text-[10px] text-muted-foreground mb-2">
            Perfect model = points sit on the diagonal. Above = over-confident, below = under-confident.
          </p>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={calibration} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="predicted"
                  type="number"
                  domain={[0, 100]}
                  stroke="var(--color-muted-foreground)"
                  fontSize={10}
                  unit="%"
                />
                <YAxis
                  type="number"
                  domain={[0, 100]}
                  stroke="var(--color-muted-foreground)"
                  fontSize={10}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    fontSize: 11,
                  }}
                  formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine
                  segment={[
                    { x: 0, y: 0 },
                    { x: 100, y: 100 },
                  ]}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="3 3"
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual hit rate"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-border bg-card rounded p-4">
          <h2 className="terminal-label mb-1">// Hit rate by confidence band</h2>
          <p className="text-[10px] text-muted-foreground mb-2">
            Higher confidence should mean higher hit rate. If flat — confidence score is noise.
          </p>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={confBands} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <XAxis dataKey="band" stroke="var(--color-muted-foreground)" fontSize={10} />
                <YAxis
                  type="number"
                  domain={[0, 100]}
                  stroke="var(--color-muted-foreground)"
                  fontSize={10}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    fontSize: 11,
                  }}
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                />
                <ReferenceLine y={50} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" />
                <Bar dataKey="hitRate">
                  {confBands.map((b, i) => (
                    <Cell
                      key={i}
                      fill={b.hitRate >= 50 ? "var(--color-primary)" : "var(--color-destructive)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {filtered.length < 20 && (
        <div className="border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/5 rounded p-3 text-xs">
          <span className="font-bold text-[color:var(--color-warning)]">// Low sample warning · </span>
          <span className="text-muted-foreground">
            {filtered.length} bets is not enough to draw conclusions. Aim for 100+ before trusting Brier / calibration shape.
          </span>
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

// ---- metrics ----

function computeMetrics(rows: Row[]) {
  if (!rows.length) return { brier: null, logLoss: null, accuracy: null, avgPred: null };
  let sse = 0;
  let ll = 0;
  let hits = 0;
  let sumPred = 0;
  for (const r of rows) {
    const e = r.predicted - r.outcome;
    sse += e * e;
    ll += -(r.outcome * Math.log(r.predicted) + (1 - r.outcome) * Math.log(1 - r.predicted));
    if ((r.predicted >= 0.5 && r.outcome === 1) || (r.predicted < 0.5 && r.outcome === 0)) hits += 1;
    sumPred += r.predicted;
  }
  return {
    brier: sse / rows.length,
    logLoss: ll / rows.length,
    accuracy: hits / rows.length,
    avgPred: sumPred / rows.length,
  };
}

function calibrationBuckets(rows: Row[]) {
  const buckets = [50, 60, 70, 80, 90];
  return buckets.map((center) => {
    const lo = (center - 5) / 100;
    const hi = (center + 5) / 100;
    const inBucket = rows.filter((r) => r.predicted >= lo && r.predicted < hi);
    const actual = inBucket.length
      ? (inBucket.filter((r) => r.outcome === 1).length / inBucket.length) * 100
      : null;
    return { predicted: center, actual: actual ?? center, n: inBucket.length };
  }).filter((b) => b.n > 0);
}

function confidenceBands(rows: Row[]) {
  const bands = [
    { band: "50-59", min: 50, max: 60 },
    { band: "60-69", min: 60, max: 70 },
    { band: "70-79", min: 70, max: 80 },
    { band: "80-89", min: 80, max: 90 },
    { band: "90+", min: 90, max: 101 },
  ];
  return bands.map((b) => {
    const inBand = rows.filter(
      (r) => r.confidence != null && r.confidence >= b.min && r.confidence < b.max
    );
    const hits = inBand.filter((r) => r.outcome === 1).length;
    return {
      band: b.band,
      hitRate: inBand.length ? (hits / inBand.length) * 100 : 0,
      n: inBand.length,
    };
  });
}

function brierLabel(b: number | null): string {
  if (b == null) return "no data";
  if (b < 0.18) return "elite";
  if (b < 0.22) return "strong";
  if (b < 0.25) return "beats coin-flip";
  return "below random";
}
