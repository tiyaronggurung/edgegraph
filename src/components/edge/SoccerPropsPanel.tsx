import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, Zap, TrendingUp } from "lucide-react";
import {
  predictMatch,
  listLiveFixtures,
  type PredictionMarket,
  type MatchPrediction,
} from "@/lib/predictionEngine.functions";

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
  const [open, setOpen] = useState(false);
  const listFn = useServerFn(listLiveFixtures);
  const predictFn = useServerFn(predictMatch);

  const fixturesQ = useQuery({
    queryKey: ["engine-live-list"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
    staleTime: 55_000,
    enabled: open,
  });

  const fixtureId = useMemo(() => {
    if (!fixturesQ.data?.matches?.length) return null;
    return fuzzyMatch(fixturesQ.data.matches, teamA, teamB);
  }, [fixturesQ.data, teamA, teamB]);

  const predictQ = useQuery({
    queryKey: ["engine-predict", fixtureId],
    queryFn: () => predictFn({ data: { fixtureId: fixtureId!, includeAi: true } }),
    enabled: open && !!fixtureId,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  return (
    <div className="border-t border-border pt-2 mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full text-[10px] uppercase tracking-widest text-[color:var(--color-primary)] hover:opacity-80"
      >
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" /> EdgeGraph AI Engine · 7 markets
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {fixturesQ.isLoading && (
            <Spinner label="Loading live feed…" />
          )}
          {fixturesQ.data?.error && (
            <div className="text-[10px] text-amber-400">Feed: {fixturesQ.data.error}</div>
          )}
          {fixturesQ.data && !fixtureId && !fixturesQ.isLoading && (
            <div className="text-[10px] text-muted-foreground">
              Match not currently live on stats provider. Predictions unlock at kickoff.
            </div>
          )}
          {predictQ.isFetching && fixtureId && <Spinner label="Computing ensemble (stats + AI)…" />}
          {predictQ.data?.error && (
            <div className="text-[10px] text-amber-400">{predictQ.data.error}</div>
          )}
          {predictQ.data?.prediction && (
            <PredictionView pred={predictQ.data.prediction} marketHome={marketA} marketDraw={marketDraw} marketAway={marketB} />
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

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-muted-foreground flex justify-between">
        <span>
          ⏱ {pred.status} {pred.elapsed ? `${pred.elapsed}'` : ""} · {pred.goalsHome}-{pred.goalsAway}
        </span>
        <span>via {pred.providerId} + Poisson + Gemini</span>
      </div>

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
            <MarketCell key={m.pick} label={m.pick} prob={m.probability} stats={m.statsProb} ai={m.aiProb} />
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
              <MarketCell key={`o${m.line}`} label={`O ${m.line}`} prob={m.probability} stats={m.statsProb} ai={m.aiProb} compact />
            ))}
        </div>
      </Section>

      <Section title="Total Corners">
        <div className="grid grid-cols-2 gap-1">
          {corners.map((m) => (
            <MarketCell key={m.pick} label={`${m.pick} ${m.line}`} prob={m.probability} stats={m.statsProb} ai={m.aiProb} />
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
  compact,
}: {
  label: string;
  prob: number;
  stats: number;
  ai: number | null;
  edgeMarket?: number; // 0..100 market %
  compact?: boolean;
}) {
  const conf = Math.round(Math.abs(prob - 0.5) * 200);
  const edge = edgeMarket != null ? prob * 100 - edgeMarket : null;
  return (
    <div className={`border rounded p-1.5 ${tone(conf)}`}>
      <div className="text-[9px] uppercase tracking-widest opacity-80 truncate">{label}</div>
      <div className={`font-bold font-mono ${compact ? "text-xs" : "text-sm"}`}>{pct(prob)}</div>
      {!compact && (
        <div className="text-[9px] text-muted-foreground font-mono leading-tight">
          stat {(stats * 100).toFixed(0)}
          {ai != null ? ` · ai ${(ai * 100).toFixed(0)}` : ""}
          {edge != null ? ` · edge ${edge >= 0 ? "+" : ""}${edge.toFixed(0)}` : ""}
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
            {h ?? "—"}<span className="text-muted-foreground">/</span>{a ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
