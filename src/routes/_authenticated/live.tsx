import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { MiniProbChart } from "@/components/edge/MiniProbChart";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { ActionBadge } from "@/components/edge/ActionBadge";
import { Edge70Badge } from "@/components/edge/Edge70Badge";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { getKalshiSportsEvents, getKalshiMarketHistory } from "@/lib/kalshi.functions";
import { runAnalysis } from "@/lib/analysisEngine";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Kalshi Markets — EdgeGraph AI" }] }),
  component: LiveMarkets,
});

function LiveMarkets() {
  const eventsFn = useServerFn(getKalshiSportsEvents);
  const historyFn = useServerFn(getKalshiMarketHistory);
  const [refreshKey, setRefreshKey] = useState(0);

  const eventsQuery = useQuery({
    queryKey: ["kalshi-sports", refreshKey],
    queryFn: () => eventsFn({ data: { limit: 24 } }),
    refetchInterval: 30_000,
  });

  // Flatten all markets so we can pull history per-market.
  const allMarkets =
    eventsQuery.data?.events.flatMap((e) =>
      e.markets.map((m) => ({ event: e, market: m })),
    ) ?? [];

  const historyQueries = useQueries({
    queries: allMarkets.slice(0, 24).map(({ market }) => ({
      queryKey: ["kalshi-history", market.ticker, refreshKey],
      queryFn: () => historyFn({ data: { ticker: market.ticker, limit: 60 } }),
      staleTime: 20_000,
      refetchInterval: 30_000,
    })),
  });

  const historyByTicker = new Map<string, number[]>();
  historyQueries.forEach((q, i) => {
    const ticker = allMarkets[i]?.market.ticker;
    if (ticker && q.data) historyByTicker.set(ticker, q.data.series);
  });

  return (
    <div className="space-y-5 font-mono">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">// Live Kalshi Sports</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Public Kalshi market data · auto-refresh every 30s · {allMarkets.length} markets across{" "}
            {eventsQuery.data?.events.length ?? 0} events
          </p>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-wider rounded border border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
        >
          {eventsQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      <div className="border border-border bg-card rounded p-3 flex items-center gap-3 text-xs">
        <span className="h-2 w-2 rounded-full bg-[color:var(--color-primary)] shadow-[0_0_8px_var(--color-primary)]" />
        <span className="text-muted-foreground">Kalshi Public API</span>
        <span className="text-[color:var(--color-primary)] uppercase tracking-widest text-[10px]">LIVE</span>
        <span className="ml-auto text-muted-foreground">No API key required for read-only sports markets.</span>
      </div>

      {eventsQuery.isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading live Kalshi sports markets…
        </div>
      )}

      {eventsQuery.error && (
        <div className="border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/5 text-[color:var(--color-danger)] rounded p-3 text-xs">
          Failed to reach Kalshi: {(eventsQuery.error as Error).message}
        </div>
      )}

      {!eventsQuery.isLoading && allMarkets.length === 0 && eventsQuery.data && (
        <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
          No active sports markets returned by Kalshi right now. Try refresh.
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {allMarkets.map(({ event, market }) => {
          const series100 = (historyByTicker.get(market.ticker) ?? []).map((p) => p * 100);
          const yesPct = market.yesPrice * 100;
          const noPct = 100 - yesPct;
          // Treat the YES side as team A vs NO as the complement for the engine.
          const analysis = runAnalysis({
            sport: "Soccer", // generic fallback — Kalshi covers many sports; engine still works
            league: event.competition || event.seriesTicker,
            gameName: event.title,
            teamA: market.yesSubTitle || "YES",
            teamB: "Field/NO",
            probabilityA: yesPct,
            probabilityB: noPct,
            volume: market.volume24h,
            sportFields: {},
            notes: { market: detectShapeHint(series100) },
          });
          return (
            <div key={market.ticker} className="border border-border bg-card rounded p-4 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest truncate">
                    {event.competition || event.seriesTicker}
                  </div>
                  <div className="font-bold text-sm truncate">{event.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{market.yesSubTitle}</div>
                </div>
                {analysis.edge70Detected && <Edge70Badge detected />}
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[color:var(--color-primary)]">{yesPct.toFixed(0)}%</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">yes</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  vol24h {Math.round(market.volume24h).toLocaleString()}
                </span>
              </div>

              {series100.length > 1 ? (
                <MiniProbChart series={series100} width={280} height={70} />
              ) : (
                <div className="h-[70px] flex items-center justify-center text-[10px] text-muted-foreground border border-dashed border-border rounded">
                  {historyQueries.some((q) => q.isLoading) ? "loading trades…" : "no recent trades"}
                </div>
              )}

              <div className="flex justify-between items-center pt-1">
                <PatternBadge pattern={analysis.pattern} />
                <span className="text-xs text-muted-foreground">Edge {analysis.edgeScore.toFixed(1)}</span>
              </div>
              <ActionBadge action={analysis.recommendedAction} />

              <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground">
                <span className="truncate">{market.ticker}</span>
                <a
                  href={`https://kalshi.com/markets/${event.seriesTicker.toLowerCase()}/${event.eventTicker.toLowerCase()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-[color:var(--color-primary)]"
                >
                  Kalshi <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <Disclaimer />
      <div className="text-[10px] text-muted-foreground text-center">
        <Link to="/analyze" className="hover:text-[color:var(--color-primary)] underline">
          Upload a Kalshi screenshot to run full analysis →
        </Link>
      </div>
    </div>
  );
}

// Heuristic note builder so the rule engine picks up shape cues from the trade series.
function detectShapeHint(series: number[]): string {
  if (series.length < 6) return "";
  const first = series[0];
  const last = series[series.length - 1];
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min;
  const drop = max - last;
  const rise = last - min;
  const hints: string[] = [];
  if (range < 4) hints.push("compression");
  if (drop > 15 && max - first > 10) hints.push("spike then collapse");
  if (rise > 15 && first - min > 5) hints.push("v-reversal");
  if (range > 25) hints.push("chaotic swinging");
  return hints.join(", ");
}
