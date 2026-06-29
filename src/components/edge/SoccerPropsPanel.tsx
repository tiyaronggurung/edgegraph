import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, Zap } from "lucide-react";
import {
  getLiveSoccerFixtures,
  getMatchStats,
  type LiveMatchStats,
  type TeamStats,
} from "@/lib/apiFootball.functions";
import { predictSoccerProps } from "@/lib/soccerProps.functions";

interface Props {
  teamA: string;
  teamB: string;
  marketA?: number; // fair % 0..100
  marketDraw?: number;
  marketB?: number;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyMatchFixture(
  fixtures: LiveMatchStats[],
  teamA: string,
  teamB: string,
): LiveMatchStats | null {
  const a = norm(teamA);
  const b = norm(teamB);
  for (const f of fixtures) {
    const h = norm(f.homeTeam);
    const w = norm(f.awayTeam);
    const matchAB = (h.includes(a) || a.includes(h)) && (w.includes(b) || b.includes(w));
    const matchBA = (h.includes(b) || b.includes(h)) && (w.includes(a) || a.includes(w));
    if (matchAB || matchBA) return f;
  }
  return null;
}

export function SoccerPropsPanel({ teamA, teamB, marketA, marketDraw, marketB }: Props) {
  const [open, setOpen] = useState(false);
  const fixturesFn = useServerFn(getLiveSoccerFixtures);
  const statsFn = useServerFn(getMatchStats);
  const predictFn = useServerFn(predictSoccerProps);

  const fixturesQ = useQuery({
    queryKey: ["af-live-fixtures"],
    queryFn: () => fixturesFn(),
    refetchInterval: 60_000,
    staleTime: 55_000,
    enabled: open,
  });

  const fixture = useMemo(() => {
    if (!fixturesQ.data?.matches?.length) return null;
    return fuzzyMatchFixture(fixturesQ.data.matches, teamA, teamB);
  }, [fixturesQ.data, teamA, teamB]);

  const statsQ = useQuery({
    queryKey: ["af-stats", fixture?.fixtureId],
    queryFn: () => statsFn({ data: { fixtureId: fixture!.fixtureId } }),
    refetchInterval: 60_000,
    staleTime: 55_000,
    enabled: open && !!fixture,
  });

  const predictQ = useQuery({
    queryKey: [
      "soccer-props",
      fixture?.fixtureId,
      fixture?.elapsed,
      fixture?.goalsHome,
      fixture?.goalsAway,
    ],
    queryFn: () =>
      predictFn({
        data: {
          homeTeam: fixture!.homeTeam,
          awayTeam: fixture!.awayTeam,
          league: fixture!.league,
          elapsed: fixture!.elapsed,
          status: fixture!.status,
          goalsHome: fixture!.goalsHome,
          goalsAway: fixture!.goalsAway,
          home: statsQ.data?.stats?.home ?? emptyStats(),
          away: statsQ.data?.stats?.away ?? emptyStats(),
          marketHome: marketA ?? null,
          marketDraw: marketDraw ?? null,
          marketAway: marketB ?? null,
        },
      }),
    enabled: open && !!fixture && !!statsQ.data,
    staleTime: 90_000,
    refetchInterval: 90_000,
  });

  return (
    <div className="border-t border-border pt-2 mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full text-[10px] uppercase tracking-widest text-[color:var(--color-primary)] hover:opacity-80"
      >
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" /> AI Prop Picks · BTTS / O-U / Corners
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {fixturesQ.isLoading && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading live match feed…
            </div>
          )}
          {!fixturesQ.isLoading && fixturesQ.data?.error && (
            <div className="text-[10px] text-amber-400">
              Stats feed: {fixturesQ.data.error}
            </div>
          )}
          {!fixturesQ.isLoading && fixturesQ.data && !fixture && (
            <div className="text-[10px] text-muted-foreground">
              Match not currently live on the stats provider (pre-match or off-feed). Props unlock once
              the match goes live.
            </div>
          )}
          {fixture && (
            <>
              <div className="text-[10px] font-mono text-muted-foreground">
                ⏱ {fixture.status} {fixture.elapsed ? `${fixture.elapsed}'` : ""} · {fixture.goalsHome}-{fixture.goalsAway}
              </div>
              {statsQ.data?.stats && (
                <StatGrid
                  home={statsQ.data.stats.home}
                  away={statsQ.data.stats.away}
                  homeName={fixture.homeTeam}
                  awayName={fixture.awayTeam}
                />
              )}
              {predictQ.isFetching && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> AI analyzing factors…
                </div>
              )}
              {predictQ.data?.error && (
                <div className="text-[10px] text-amber-400">{predictQ.data.error}</div>
              )}
              {predictQ.data?.result && <PropPicks res={predictQ.data.result} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function emptyStats(): TeamStats {
  return {
    shots: null,
    shotsOnTarget: null,
    possession: null,
    corners: null,
    fouls: null,
    attacks: null,
    dangerousAttacks: null,
    yellowCards: null,
    redCards: null,
    expectedGoals: null,
  };
}

function StatGrid({
  home,
  away,
  homeName,
  awayName,
}: {
  home: ReturnType<typeof emptyStats>;
  away: ReturnType<typeof emptyStats>;
  homeName: string;
  awayName: string;
}) {
  const Row = ({ label, h, a }: { label: string; h: number | null; a: number | null }) => (
    <div className="grid grid-cols-3 text-[10px] font-mono">
      <span className="text-right">{h ?? "—"}</span>
      <span className="text-center text-muted-foreground">{label}</span>
      <span>{a ?? "—"}</span>
    </div>
  );
  return (
    <div className="bg-background/40 border border-border rounded p-2 space-y-0.5">
      <div className="grid grid-cols-3 text-[9px] uppercase tracking-widest text-muted-foreground pb-1">
        <span className="text-right truncate">{homeName}</span>
        <span className="text-center">stat</span>
        <span className="truncate">{awayName}</span>
      </div>
      <Row label="Shots" h={home.shots} a={away.shots} />
      <Row label="On Target" h={home.shotsOnTarget} a={away.shotsOnTarget} />
      <Row label="Poss %" h={home.possession} a={away.possession} />
      <Row label="Corners" h={home.corners} a={away.corners} />
      <Row label="Dang Attk" h={home.dangerousAttacks} a={away.dangerousAttacks} />
      <Row label="Fouls" h={home.fouls} a={away.fouls} />
    </div>
  );
}

function PickCard({
  title,
  pick,
  conf,
  reason,
}: {
  title: string;
  pick: string;
  conf: number;
  reason: string;
}) {
  const tone =
    conf >= 80
      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
      : conf >= 65
        ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
        : "border-border bg-muted/20 text-muted-foreground";
  return (
    <div className={`border rounded p-2 ${tone}`}>
      <div className="flex justify-between items-center text-[10px] uppercase tracking-widest">
        <span>{title}</span>
        <span className="font-mono font-bold">{conf.toFixed(0)}%</span>
      </div>
      <div className="font-bold text-sm font-mono">{pick}</div>
      <div className="text-[10px] text-foreground/70 mt-1">{reason}</div>
    </div>
  );
}

function PropPicks({
  res,
}: {
  res: import("@/lib/soccerProps.functions").SoccerPropsResult;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <PickCard
          title="BTTS"
          pick={res.btts.pick}
          conf={res.btts.confidencePct}
          reason={res.btts.reasoning}
        />
        <PickCard
          title={`Goals O/U ${res.totalGoals.line}`}
          pick={res.totalGoals.pick}
          conf={res.totalGoals.confidencePct}
          reason={res.totalGoals.reasoning}
        />
        <PickCard
          title={`Corners O/U ${res.totalCorners.line}`}
          pick={res.totalCorners.pick}
          conf={res.totalCorners.confidencePct}
          reason={res.totalCorners.reasoning}
        />
      </div>
      <div className="text-[10px] text-muted-foreground">
        <div className="font-bold uppercase tracking-widest">Momentum: {res.momentum}</div>
        <div className="mt-0.5">{res.summary}</div>
        <ul className="list-disc list-inside mt-1 space-y-0.5">
          {res.keyFactors.map((k, i) => (
            <li key={i}>{k}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
