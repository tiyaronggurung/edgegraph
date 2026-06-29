import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ExternalLink } from "lucide-react";
import { getKalshiSportsEvents, type KalshiEventLite } from "@/lib/kalshi.functions";
import { detectSoccer3Way, isSoccerEvent } from "@/lib/kalshiSoccer";
import { ProbabilityBar } from "@/components/edge/ProbabilityBar";
import { SoccerBetAlert } from "@/components/edge/SoccerBetAlert";
import { SoccerPropsPanel } from "@/components/edge/SoccerPropsPanel";

interface SoccerCard {
  event: KalshiEventLite;
  fair: { a: number; draw: number; b: number };
  raw: { a: number; draw: number; b: number };
  teamA: string;
  teamB: string;
  topVolume: number;
}

function pickPrediction(fair: { a: number; draw: number; b: number }, teamA: string, teamB: string) {
  const entries: Array<{ label: string; pct: number; key: "a" | "draw" | "b" }> = [
    { label: teamA, pct: fair.a * 100, key: "a" },
    { label: "Draw", pct: fair.draw * 100, key: "draw" },
    { label: teamB, pct: fair.b * 100, key: "b" },
  ];
  entries.sort((x, y) => y.pct - x.pct);
  const top = entries[0];
  const margin = top.pct - entries[1].pct;
  const confidence = top.pct >= 60 && margin >= 15 ? "HIGH" : top.pct >= 45 ? "MED" : "LOW";
  return { top, margin, confidence };
}

export function DashboardLiveSoccer() {
  const eventsFn = useServerFn(getKalshiSportsEvents);
  const q = useQuery({
    queryKey: ["dashboard-live-soccer"],
    queryFn: () => eventsFn({ data: { limit: 120 } }),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const cards: SoccerCard[] = [];
  for (const e of q.data?.events ?? []) {
    if (!isSoccerEvent(e)) continue;
    const tw = detectSoccer3Way(e);
    if (!tw) continue;
    const topVolume = Math.max(
      tw.marketA.volume24h,
      tw.marketB.volume24h,
      tw.marketDraw.volume24h,
    );
    cards.push({
      event: e,
      fair: tw.fair,
      raw: tw.raw,
      teamA: tw.teamA,
      teamB: tw.teamB,
      topVolume,
    });
  }
  cards.sort((a, b) => b.topVolume - a.topVolume);
  const top = cards.slice(0, 6);

  return (
    <div className="border border-border bg-card rounded">
      <div className="p-4 border-b border-border flex justify-between items-center">
        <div>
          <h2 className="terminal-label">// Live Soccer · 3-way predictions</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Kalshi de-vigged · auto-refresh every 30s
          </p>
        </div>
        <Link
          to="/live"
          search={{ sport: "soccer" } as never}
          className="text-xs uppercase tracking-wider text-[color:var(--color-primary)] hover:underline"
        >
          All soccer →
        </Link>
      </div>

      {q.isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading live soccer markets…
        </div>
      )}

      {!q.isLoading && top.length === 0 && (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No live soccer 3-way markets on Kalshi right now. Check back closer to match kickoff.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3 p-3">
        {top.map((c) => {
          const pred = pickPrediction(c.fair, c.teamA, c.teamB);
          const rawForPick =
            pred.top.key === "a" ? c.raw.a : pred.top.key === "draw" ? c.raw.draw : c.raw.b;
          const tone =
            pred.confidence === "HIGH"
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : pred.confidence === "MED"
                ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                : "border-border bg-muted/30 text-muted-foreground";
          return (
            <div
              key={c.event.eventTicker}
              className="border border-border bg-background/40 rounded p-3 space-y-2"
            >
              {pred.confidence === "HIGH" && (
                <SoccerBetAlert
                  marketTicker={c.event.eventTicker}
                  marketTitle={`${c.teamA} vs ${c.teamB}`}
                  pickLabel={pred.top.label}
                  fairPct={pred.top.pct}
                  marketPct={rawForPick * 100}
                  edgePts={pred.top.pct - rawForPick * 100}
                />
              )}
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">
                    ⚽ {c.event.competition || c.event.seriesTicker}
                  </div>
                  <div className="font-bold text-sm truncate">
                    {c.teamA} <span className="text-muted-foreground">vs</span> {c.teamB}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold uppercase tracking-widest rounded px-1.5 py-0.5 border shrink-0 ${tone}`}
                >
                  {pred.confidence}
                </span>
              </div>

              <ProbabilityBar
                a={c.fair.a * 100}
                b={c.fair.b * 100}
                draw={c.fair.draw * 100}
                labelA={c.teamA}
                labelB={c.teamB}
                labelDraw="Draw"
              />

              <div className="text-[11px] font-mono">
                <span className="text-muted-foreground">Pick: </span>
                <span className="font-bold text-[color:var(--color-primary)]">
                  {pred.top.label}
                </span>
                <span className="text-muted-foreground">
                  {" "}· {pred.top.pct.toFixed(0)}% (edge +{pred.margin.toFixed(0)}pt)
                </span>
              </div>

              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                <span>vol24h ${Math.round(c.topVolume).toLocaleString()}</span>
                <a
                  href={`https://kalshi.com/markets/${c.event.seriesTicker.toLowerCase()}/${c.event.eventTicker.toLowerCase()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-[color:var(--color-primary)]"
                >
                  Kalshi <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <SoccerPropsPanel
                teamA={c.teamA}
                teamB={c.teamB}
                marketA={c.fair.a * 100}
                marketDraw={c.fair.draw * 100}
                marketB={c.fair.b * 100}
              />

            </div>
          );
        })}
      </div>
    </div>
  );
}
