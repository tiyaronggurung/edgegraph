import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, Zap, TrendingUp, Activity, Target, Flame } from "lucide-react";
import { LineChart, Line, YAxis, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  listStoredLiveFixtures,
  getStoredPrediction,
  getPredictionHistory,
  type HistorySeries,
} from "@/lib/storedPredictions.functions";
import type { MatchPrediction } from "@/lib/predictionEngine.functions";


interface Props {
  teamA: string;
  teamB: string;
  marketA?: number;
  marketDraw?: number;
  marketB?: number;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyMatch(
  fixtures: Array<{ fixtureId: string; homeTeam: string; awayTeam: string }>,
  a: string,
  b: string,
): string | null {
  const na = norm(a);
  const nb = norm(b);
  for (const f of fixtures) {
    const h = norm(f.homeTeam);
    const w = norm(f.awayTeam);
    if (
      ((h.includes(na) || na.includes(h)) && (w.includes(nb) || nb.includes(w))) ||
      ((h.includes(nb) || nb.includes(h)) && (w.includes(na) || na.includes(w)))
    )
      return f.fixtureId;
  }
  return null;
}

function pct(n: number) {
  return `${(n * 100).toFixed(0)}%`;
}

function tone(conf: number) {
  if (conf >= 60) return "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
  if (conf >= 30) return "border-amber-500/50 bg-amber-500/10 text-amber-400";
  return "border-border bg-muted/20 text-muted-foreground";
}

export function SoccerPropsPanel({ teamA, teamB, marketA, marketDraw, marketB }: Props) {
  const [open, setOpen] = useState(true);
  const listFn = useServerFn(listStoredLiveFixtures);
  const predictFn = useServerFn(getStoredPrediction);
  const qc = useQueryClient();

  const fixturesQ = useQuery({
    queryKey: ["stored-live-list"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
    enabled: open,
  });

  const fixtureId = useMemo(() => {
    if (!fixturesQ.data?.matches?.length) return null;
    return fuzzyMatch(fixturesQ.data.matches, teamA, teamB);
  }, [fixturesQ.data, teamA, teamB]);

  const predictQ = useQuery({
    queryKey: ["stored-predict", fixtureId],
    queryFn: () => predictFn({ data: { fixtureId: fixtureId! } }),
    enabled: open && !!fixtureId,
    refetchInterval: 60_000,
  });

  // Realtime: push updates the moment the worker upserts new probabilities.
  useEffect(() => {
    if (!open || !fixtureId) return;
    const channel = supabase
      .channel(`live-pred-${fixtureId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_predictions",
          filter: `fixture_id=eq.${fixtureId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["stored-predict", fixtureId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, fixtureId, qc]);

  return (
    <div className="border-t border-border pt-2 mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full text-[10px] uppercase tracking-widest text-[color:var(--color-primary)] hover:opacity-80"
      >
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" /> EdgeGraph AI Engine · live ensemble
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {fixturesQ.isLoading && <Spinner label="Loading live board…" />}
          {fixturesQ.data?.error && (
            <div className="text-[10px] text-amber-400">Feed: {fixturesQ.data.error}</div>
          )}
          {fixturesQ.data && !fixtureId && !fixturesQ.isLoading && (
            <div className="text-[10px] text-muted-foreground">
              Match not yet computed by worker. Refreshes every minute at kickoff.
            </div>
          )}
          {predictQ.isLoading && fixtureId && <Spinner label="Loading prediction…" />}
          {predictQ.data?.error && (
            <div className="text-[10px] text-amber-400">{predictQ.data.error}</div>
          )}
          {predictQ.data?.prediction && (
            <>
              <PredictionView
                pred={predictQ.data.prediction}
                marketHome={marketA}
                marketDraw={marketDraw}
                marketAway={marketB}
              />
              <ProbabilityChart fixtureId={fixtureId!} computedAt={predictQ.data.prediction.computedAt} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> {label}
    </div>
  );
}

function PredictionView({
  pred,
  marketHome,
  marketDraw,
  marketAway,
}: {
  pred: MatchPrediction;
  marketHome?: number;
  marketDraw?: number;
  marketAway?: number;
}) {
  const byMarket = (name: string) => pred.markets.filter((m) => m.market === name);
  const ml = byMarket("1X2");
  const btts = byMarket("BTTS");
  const nextGoal = byMarket("NEXT_GOAL");
  const goals = byMarket("GOALS");
  const corners = byMarket("CORNERS");
  const age = Math.max(0, Math.round((Date.now() - pred.computedAt) / 1000));

  // Devig the Kalshi 1X2 market into fair implied probabilities for the 4th column.
  const marketImplied = useMemo(() => {
    const legs: { pick: string; pct: number }[] = [];
    if (marketHome != null) legs.push({ pick: "HOME", pct: marketHome });
    if (marketDraw != null) legs.push({ pick: "DRAW", pct: marketDraw });
    if (marketAway != null) legs.push({ pick: "AWAY", pct: marketAway });
    const sum = legs.reduce((a, b) => a + Math.max(0, b.pct), 0);
    if (sum <= 0) return new Map<string, number>();
    return new Map(legs.map((l) => [l.pick, Math.max(0, l.pct) / sum]));
  }, [marketHome, marketDraw, marketAway]);

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-muted-foreground flex justify-between">
        <span>
          ⏱ {pred.status} {pred.elapsed ? `${pred.elapsed}'` : ""} · {pred.goalsHome}-
          {pred.goalsAway}
          {pred.explanation && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] uppercase tracking-widest">
              <Flame className="h-2.5 w-2.5" /> {pred.explanation.momentum}
            </span>
          )}
        </span>
        <span>updated {age}s ago · live push</span>
      </div>

      <TopPicks pred={pred} marketImplied={marketImplied} />

      <StatStrip snap={pred.snapshot} />


      <Section title="Match Result (1X2)">
        <div className="grid grid-cols-3 gap-1">
          {ml.map((m) => (
            <MarketCell
              key={m.pick}
              label={m.pick === "HOME" ? pred.homeTeam : m.pick === "AWAY" ? pred.awayTeam : "Draw"}
              prob={m.probability}
              stats={m.statsProb}
              ai={m.aiProb}
              marketImplied={marketImplied.get(m.pick) ?? null}
              edgeMarket={
                m.pick === "HOME" ? marketHome : m.pick === "DRAW" ? marketDraw : marketAway
              }
            />
          ))}
        </div>
      </Section>


      <Section title="Both Teams To Score">
        <div className="grid grid-cols-2 gap-1">
          {btts.map((m) => (
            <MarketCell
              key={m.pick}
              label={m.pick}
              prob={m.probability}
              stats={m.statsProb}
              ai={m.aiProb}
            />
          ))}
        </div>
      </Section>

      <Section title="Next Goal">
        <div className="grid grid-cols-3 gap-1">
          {nextGoal.map((m) => (
            <MarketCell
              key={m.pick}
              label={m.pick === "HOME" ? pred.homeTeam : m.pick === "AWAY" ? pred.awayTeam : "None"}
              prob={m.probability}
              stats={m.statsProb}
              ai={m.aiProb}
            />
          ))}
        </div>
      </Section>

      <Section title="Total Goals (Over)">
        <div className="grid grid-cols-5 gap-1">
          {goals
            .filter((m) => m.pick === "OVER")
            .map((m) => (
              <MarketCell
                key={`o${m.line}`}
                label={`O ${m.line}`}
                prob={m.probability}
                stats={m.statsProb}
                ai={m.aiProb}
                compact
              />
            ))}
        </div>
      </Section>

      <Section title="Total Corners">
        <div className="grid grid-cols-2 gap-1">
          {corners.map((m) => (
            <MarketCell
              key={m.pick}
              label={`${m.pick} ${m.line}`}
              prob={m.probability}
              stats={m.statsProb}
              ai={m.aiProb}
            />
          ))}
        </div>
      </Section>

      {pred.explanation && (
        <div className="border border-border rounded p-2 bg-background/40 space-y-1 text-[10px]">
          <div className="flex items-center gap-1 text-[color:var(--color-primary)] uppercase tracking-widest font-bold">
            <TrendingUp className="h-3 w-3" /> Momentum: {pred.explanation.momentum}
          </div>
          <div className="text-foreground/80">{pred.explanation.summary}</div>
          {pred.explanation.changes.length > 0 && (
            <ul className="list-disc list-inside text-amber-400 space-y-0.5">
              {pred.explanation.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {pred.explanation.keyFactors.length > 0 && (
            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
              {pred.explanation.keyFactors.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}

function MarketCell({
  label,
  prob,
  stats,
  ai,
  edgeMarket,
  marketImplied,
  compact,
}: {
  label: string;
  prob: number;
  stats: number;
  ai: number | null;
  edgeMarket?: number;
  marketImplied?: number | null;
  compact?: boolean;
}) {
  const conf = Math.round(Math.abs(prob - 0.5) * 200);
  const edge = edgeMarket != null ? prob * 100 - edgeMarket : null;
  const fair = prob > 0.02 ? (1 / prob).toFixed(2) : "—";
  const tier = conf >= 60 ? "HIGH" : conf >= 30 ? "MED" : "LOW";
  return (
    <div className={`border rounded p-1.5 ${tone(conf)}`}>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[9px] uppercase tracking-widest opacity-80 truncate">{label}</div>
        {!compact && <div className="text-[8px] font-bold opacity-70">{tier}</div>}
      </div>
      <div className={`font-bold font-mono ${compact ? "text-xs" : "text-sm"}`}>{pct(prob)}</div>
      {!compact && (
        <div className="text-[9px] text-foreground/70 font-mono leading-tight">
          fair ≥ {fair}
        </div>
      )}
      {!compact && (
        <div className="text-[9px] text-muted-foreground font-mono leading-tight">
          stat {(stats * 100).toFixed(0)}
          {ai != null ? ` · ai ${(ai * 100).toFixed(0)}` : ""}
          {marketImplied != null ? ` · mkt ${(marketImplied * 100).toFixed(0)}` : ""}
          {edge != null ? ` · edge ${edge >= 0 ? "+" : ""}${edge.toFixed(0)}` : ""}
        </div>
      )}
    </div>
  );
}

function TopPicks({
  pred,
  marketImplied,
}: {
  pred: MatchPrediction;
  marketImplied: Map<string, number>;
}) {
  const teamLabel = (m: { market: string; pick: string; line?: number | null }) => {
    if (m.market === "1X2" || m.market === "NEXT_GOAL") {
      if (m.pick === "HOME") return pred.homeTeam;
      if (m.pick === "AWAY") return pred.awayTeam;
      return m.pick === "DRAW" ? "Draw" : "No goal";
    }
    if (m.market === "BTTS") return `BTTS ${m.pick}`;
    if (m.market === "GOALS") return `${m.pick} ${m.line} goals`;
    if (m.market === "CORNERS") return `${m.pick} ${m.line} corners`;
    return `${m.market} ${m.pick}`;
  };

  const ranked = useMemo(() => {
    return pred.markets
      .filter((m) => m.probability > 0.05 && m.probability < 0.97)
      .map((m) => {
        const mkt =
          m.market === "1X2" ? marketImplied.get(m.pick) ?? null : null;
        const edge = mkt != null ? (m.probability - mkt) * 100 : 0;
        const score = m.probability * 100 + Math.max(0, edge) * 2;
        return { m, edge, mkt, score, fair: 1 / m.probability };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [pred, marketImplied]);

  if (!ranked.length) return null;
  const best = ranked[0];

  return (
    <div className="rounded-md border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent p-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-emerald-400">
        <Target className="h-3 w-3" /> Model's Top Pick
      </div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold text-foreground">
          {teamLabel(best.m)}
        </div>
        <div className="font-mono text-xs text-emerald-400">
          {pct(best.m.probability)} · bet ≥ {best.fair.toFixed(2)}
          {best.edge !== 0 && (
            <span className={best.edge > 0 ? "text-emerald-300 ml-1" : "text-rose-400 ml-1"}>
              ({best.edge >= 0 ? "+" : ""}{best.edge.toFixed(0)}% edge)
            </span>
          )}
        </div>
      </div>
      {ranked.length > 1 && (
        <div className="border-t border-emerald-500/20 pt-1.5 space-y-0.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Other value
          </div>
          {ranked.slice(1).map((r, i) => (
            <div key={i} className="flex justify-between text-[10px] font-mono">
              <span className="text-foreground/80">{teamLabel(r.m)}</span>
              <span className="text-muted-foreground">
                {pct(r.m.probability)} · ≥ {r.fair.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatStrip({ snap }: { snap: MatchPrediction["snapshot"] }) {
  const cells: Array<[string, number | null, number | null]> = [
    ["Shots", snap.home.shots, snap.away.shots],
    ["SoT", snap.home.shotsOnTarget, snap.away.shotsOnTarget],
    ["Poss%", snap.home.possession, snap.away.possession],
    ["Corners", snap.home.corners, snap.away.corners],
    ["DangAttk", snap.home.dangerousAttacks, snap.away.dangerousAttacks],
    ["xG", snap.home.expectedGoals, snap.away.expectedGoals],
  ];
  return (
    <div className="grid grid-cols-6 gap-1 text-[9px] font-mono">
      {cells.map(([l, h, a]) => (
        <div key={l} className="bg-background/40 border border-border rounded p-1 text-center">
          <div className="text-muted-foreground uppercase tracking-widest">{l}</div>
          <div>
            {h ?? "—"}
            <span className="text-muted-foreground">/</span>
            {a ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

function ProbabilityChart({ fixtureId, computedAt }: { fixtureId: string; computedAt: number }) {
  const historyFn = useServerFn(getPredictionHistory);
  const q = useQuery({
    queryKey: ["pred-history", fixtureId, computedAt],
    queryFn: () => historyFn({ data: { fixtureId } }),
    staleTime: 30_000,
  });

  const data = useMemo(() => {
    const series = q.data?.series ?? [];
    // Only chart the headline markets
    const keep = series.filter(
      (s: HistorySeries) =>
        (s.market === "1X2" && (s.pick === "HOME" || s.pick === "AWAY")) ||
        (s.market === "BTTS" && s.pick === "YES") ||
        (s.market === "GOALS" && s.line === 2.5 && s.pick === "OVER"),
    );
    if (!keep.length) return { rows: [], keys: [] as HistorySeries[] };
    const all = new Set<number>();
    keep.forEach((s) => s.points.forEach((p) => all.add(p.t)));
    const times = Array.from(all).sort((a, b) => a - b);
    const rows = times.map((t) => {
      const row: Record<string, number | string> = { t: new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
      keep.forEach((s) => {
        // Find closest point at or before t
        let last: number | null = null;
        for (const p of s.points) {
          if (p.t <= t) last = p.probability * 100;
          else break;
        }
        if (last != null) row[s.label] = Number(last.toFixed(1));
      });
      return row;
    });
    return { rows, keys: keep };
  }, [q.data]);

  if (q.isLoading) return <Spinner label="Loading probability trend…" />;
  if (!data.rows.length) {
    return (
      <div className="text-[10px] text-muted-foreground italic">
        Trend will appear after a few worker ticks.
      </div>
    );
  }

  return (
    <div className="border border-border rounded p-2 bg-background/40">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
        <Activity className="h-3 w-3" /> Probability Trend
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.rows} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
            <XAxis dataKey="t" tick={{ fontSize: 8 }} stroke="currentColor" opacity={0.4} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 8 }} stroke="currentColor" opacity={0.4} width={28} />
            <Tooltip
              contentStyle={{
                background: "rgba(15,15,18,0.95)",
                border: "1px solid hsl(var(--border))",
                fontSize: 10,
              }}
            />
            {data.keys.map((s, i) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={s.label}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-2 mt-1 text-[9px]">
        {data.keys.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
            <span className="inline-block w-2 h-0.5" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
