import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useMemo, useState } from "react";
import { MiniProbChart } from "@/components/edge/MiniProbChart";
import { PatternBadge } from "@/components/edge/PatternBadge";
import { ActionBadge } from "@/components/edge/ActionBadge";
import { Edge70Badge } from "@/components/edge/Edge70Badge";
import { Disclaimer } from "@/components/edge/Disclaimer";
import { VerdictCard } from "@/components/edge/VerdictCard";
import { AiCoachBanner } from "@/components/edge/AiCoachBanner";
import { getKalshiSportsEvents, getKalshiMarketHistory } from "@/lib/kalshi.functions";
import { getLiveGameStats, computeFairProbability, type LiveGameStats } from "@/lib/espn.functions";
import { getNoVigFairLine } from "@/lib/oddsApi.functions";
import { saveBetFromMarket, getBankrollStats } from "@/lib/bets.functions";
import { computeKellyStake, computeKellyPresets, type RiskTolerance } from "@/lib/kelly";
import { detectMovement } from "@/lib/movement";
import { computeConfidence } from "@/lib/confidence";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { runAnalysis } from "@/lib/analysisEngine";
import { Loader2, RefreshCw, ExternalLink, Activity, TrendingUp, BookmarkPlus, Check, DollarSign } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Kalshi Markets — EdgeGraph AI" }] }),
  component: LiveMarkets,
});

const SPORT_FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "nba", label: "🏀 NBA", match: (s: string) => /nba|basketball/i.test(s) && !/wnba|college/i.test(s) },
  { key: "wnba", label: "🏀 WNBA", match: (s: string) => /wnba/i.test(s) },
  { key: "nfl", label: "🏈 NFL", match: (s: string) => /nfl|football/i.test(s) && !/college/i.test(s) },
  { key: "mlb", label: "⚾ MLB", match: (s: string) => /mlb|baseball/i.test(s) },
  { key: "nhl", label: "🏒 NHL", match: (s: string) => /nhl|hockey/i.test(s) },
  { key: "soccer", label: "⚽ Soccer", match: (s: string) => /soccer|mls|epl|ucl|serie|liga|bundes/i.test(s) },
  { key: "tennis", label: "🎾 Tennis", match: (s: string) => /tennis|atp|wta|open/i.test(s) },
  { key: "golf", label: "⛳ Golf", match: (s: string) => /golf|pga|masters/i.test(s) },
] as const;

const VOLUME_OPTIONS = [0, 100, 1_000, 10_000, 100_000] as const;

function LiveMarkets() {
  const eventsFn = useServerFn(getKalshiSportsEvents);
  const historyFn = useServerFn(getKalshiMarketHistory);
  const statsFn = useServerFn(getLiveGameStats);
  const bankrollFn = useServerFn(getBankrollStats);
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [minVolume, setMinVolume] = useState<number>(0);
  const [edge70Only, setEdge70Only] = useState(false);
  const [highConfOnly, setHighConfOnly] = useState(false);
  const [minEdgePts, setMinEdgePts] = useState<number>(8);
  const [minScore, setMinScore] = useState<number>(0);

  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("bankroll, default_unit, risk_tolerance")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const profile = {
    bankroll: Number(profileQ.data?.bankroll ?? 1000),
    unit: Number(profileQ.data?.default_unit ?? 25),
    risk: (profileQ.data?.risk_tolerance ?? "Medium") as RiskTolerance,
  };

  const bankrollQ = useQuery({
    queryKey: ["bankroll-stats", user?.id, refreshKey],
    queryFn: () => bankrollFn(),
    enabled: !!user,
    staleTime: 30_000,
  });


  const eventsQuery = useQuery({
    queryKey: ["kalshi-sports", refreshKey],
    queryFn: () => eventsFn({ data: { limit: 120 } }),
    refetchInterval: 30_000,
  });

  // Flatten all markets so we can pull history per-market.
  const allMarkets = useMemo(
    () =>
      eventsQuery.data?.events.flatMap((e) =>
        e.markets.map((m) => ({ event: e, market: m })),
      ) ?? [],
    [eventsQuery.data],
  );

  const historyQueries = useQueries({
    queries: allMarkets.slice(0, 30).map(({ market }) => ({
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

  // Live ESPN game stats per market — best-effort match by event title + competition.
  const statsQueries = useQueries({
    queries: allMarkets.slice(0, 30).map(({ event, market }) => {
      const teams = parseTeamsFromEvent(event.subTitle, event.title, market.yesSubTitle);
      return {
        queryKey: ["espn-stats", market.ticker, refreshKey],
        queryFn: () =>
          statsFn({
            data: {
              teamA: teams.a,
              teamB: teams.b,
              leagueHint: event.competition || event.seriesTicker,
            },
          }),
        staleTime: 20_000,
        refetchInterval: 30_000,
        retry: false,
      };
    }),
  });

  const statsByTicker = new Map<string, LiveGameStats | null>();
  statsQueries.forEach((q, i) => {
    const ticker = allMarkets[i]?.market.ticker;
    if (ticker) statsByTicker.set(ticker, (q.data ?? null) as LiveGameStats | null);
  });

  // Build scored cards once, then filter.
  const cards = useMemo(
    () =>
      allMarkets.map(({ event, market }) => {
        const series100 = (historyByTicker.get(market.ticker) ?? []).map((p) => p * 100);
        const yesPct = market.yesPrice * 100;
        const noPct = 100 - yesPct;
        const analysis = runAnalysis({
          sport: "Soccer",
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
        const stats = statsByTicker.get(market.ticker) ?? null;
        const fv = stats ? computeFairProbability(stats, yesPct, market.yesSubTitle) : null;
        const movement = detectMovement(series100, fv?.fairProb);
        const confidence = computeConfidence({ fv, stats, movement, volume24h: market.volume24h });
        return { event, market, series100, yesPct, analysis, stats, fv, movement, confidence };
      }),
    // historyByTicker / statsByTicker rebuilt every render, intentional dep simplification
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMarkets, historyQueries.map((q) => q.dataUpdatedAt).join(","), statsQueries.map((q) => q.dataUpdatedAt).join(",")],
  );

  const filtered = useMemo(() => {
    const f = SPORT_FILTERS.find((s) => s.key === sportFilter) ?? SPORT_FILTERS[0];
    return cards.filter((c) => {
      const hint = `${c.event.competition} ${c.event.seriesTicker} ${c.event.title}`;
      if (!f.match(hint)) return false;
      if (c.market.volume24h < minVolume) return false;
      if (edge70Only && !c.analysis.edge70Detected) return false;
      if (highConfOnly) {
        if (!c.fv) return false;
        if (c.fv.fairProb < 0.7) return false;
        if (c.fv.edgePts < minEdgePts) return false;
        // Require outcome lean to agree with YES side if available.
        const lean = c.stats?.outcomeLean;
        if (lean?.favored) {
          const yesTeam = c.fv.yesTeam === "home" ? c.stats!.home.name : c.stats!.away.name;
          if (lean.favored !== yesTeam && lean.lean >= 40) return false;
        }
      }
      if (minScore > 0 && c.confidence.score < minScore) return false;
      return true;
    });
  }, [cards, sportFilter, minVolume, edge70Only, highConfOnly, minEdgePts, minScore]);

  return (
    <div className="space-y-5 font-mono">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">// Live Kalshi Sports</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Kalshi + ESPN live · auto-refresh every 30s · showing {filtered.length} of {cards.length} markets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BankrollChip
            bankroll={profile.bankroll}
            openStake={bankrollQ.data?.openStake ?? 0}
            openCount={bankrollQ.data?.openCount ?? 0}
            realized={bankrollQ.data?.realized ?? 0}
            settledCount={bankrollQ.data?.settledCount ?? 0}
          />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-wider rounded border border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
          >
            {eventsQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>

      </div>

      {/* Filters */}
      <div className="border border-border bg-card rounded p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {SPORT_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSportFilter(f.key)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
                sportFilter === f.key
                  ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Min vol 24h</span>
            <select
              value={minVolume}
              onChange={(e) => setMinVolume(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs"
            >
              {VOLUME_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "any" : v.toLocaleString() + "+"}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={edge70Only}
              onChange={(e) => setEdge70Only(e.target.checked)}
              className="accent-[color:var(--color-primary)]"
            />
            <span className="uppercase tracking-widest text-muted-foreground">Edge70 only</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={highConfOnly}
              onChange={(e) => setHighConfOnly(e.target.checked)}
              className="accent-[color:var(--color-primary)]"
            />
            <span className="uppercase tracking-widest text-muted-foreground">
              High-confidence (Fair ≥70%)
            </span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Min edge</span>
            <select
              value={minEdgePts}
              onChange={(e) => setMinEdgePts(Number(e.target.value))}
              disabled={!highConfOnly}
              className="bg-background border border-border rounded px-2 py-1 text-xs disabled:opacity-50"
            >
              {[5, 8, 10, 15, 20].map((v) => (
                <option key={v} value={v}>
                  +{v}pts
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Min score</span>
            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs"
            >
              {[0, 50, 70, 85].map((v) => (
                <option key={v} value={v}>{v === 0 ? "any" : `★ ${v}+`}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="border border-border bg-card rounded p-3 flex items-center gap-3 text-xs flex-wrap">
        <span className="h-2 w-2 rounded-full bg-[color:var(--color-primary)] shadow-[0_0_8px_var(--color-primary)]" />
        <span className="text-muted-foreground">Kalshi Public API</span>
        <span className="text-[color:var(--color-primary)] uppercase tracking-widest text-[10px]">LIVE</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">ESPN scoreboard</span>
        <span className="text-[color:var(--color-primary)] uppercase tracking-widest text-[10px]">LIVE</span>
        <span className="ml-auto text-muted-foreground">Comeback alerts powered by live game state.</span>
      </div>

      <AiCoachBanner
        cards={filtered}
        bankroll={profile.bankroll}
        unit={profile.unit}
        userId={user?.id ?? null}
      />

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

      {!eventsQuery.isLoading && filtered.length === 0 && cards.length > 0 && (
        <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
          No markets match the current filters. Try widening the sport or lowering min volume.
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(({ event, market, series100, yesPct, analysis, stats, fv, movement: move, confidence }) => {
          const kelly =
            fv && fv.fairProb >= 0.55 && fv.edgePts >= 5
              ? computeKellyStake({
                  fairProb: fv.fairProb,
                  yesPrice: market.yesPrice,
                  bankroll: profile.bankroll,
                  riskTolerance: profile.risk,
                  unit: profile.unit,
                })
              : null;
          const presets =
            fv && fv.fairProb >= 0.55 && fv.edgePts >= 5
              ? computeKellyPresets(fv.fairProb, market.yesPrice, profile.bankroll, profile.unit)
              : null;
          const scoreTone =
            confidence.score >= 70
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
              : confidence.score >= 50
              ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
              : "border-border bg-muted/30 text-muted-foreground";
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
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div
                  className={`text-[10px] font-mono font-bold uppercase tracking-widest rounded px-1.5 py-0.5 border ${scoreTone}`}
                  title={"Edge " + confidence.parts.edge + "/40 · Lean " + confidence.parts.lean + "/20 · Momentum " + confidence.parts.momentum + "/15 · Liquidity " + confidence.parts.liquidity + "/15 · Progress " + confidence.parts.progress + "/10"}
                >
                  ★ {confidence.score} {confidence.grade}
                </div>
                {analysis.edge70Detected && <Edge70Badge detected />}
              </div>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[color:var(--color-primary)]">{yesPct.toFixed(0)}%</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">yes</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                vol24h {Math.round(market.volume24h).toLocaleString()}
              </span>
            </div>

            {market.closeTime && (() => {
              const ms = new Date(market.closeTime).getTime() - Date.now();
              if (!Number.isFinite(ms)) return null;
              const abs = Math.abs(ms);
              const d = Math.floor(abs / 86400000);
              const h = Math.floor((abs % 86400000) / 3600000);
              const m = Math.floor((abs % 3600000) / 60000);
              const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
              return (
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {ms > 0 ? `closes in ${parts}` : `closed ${parts} ago`}
                </div>
              );
            })()}

            {series100.length > 1 ? (
              <MiniProbChart series={series100} width={280} height={70} />
            ) : (
              <div className="h-[70px] flex items-center justify-center text-[10px] text-muted-foreground border border-dashed border-border rounded">
                no recent trades
              </div>
            )}

            {move.kind && (
              <div
                className={
                  "text-[10px] font-mono font-bold uppercase tracking-widest rounded px-1.5 py-1 border " +
                  (move.tone === "buy"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    : move.tone === "fade"
                    ? "border-red-500/50 bg-red-500/10 text-red-400"
                    : "border-border bg-muted/30 text-muted-foreground")
                }
              >
                {move.label}
              </div>
            )}

            <VerdictCard
              fairProb={fv?.fairProb}
              marketYesPct={yesPct}
              yesLabel={market.yesSubTitle}
              pattern={analysis.pattern}
              kellyHalfStake={presets?.half ?? null}
              userId={user?.id ?? null}
              marketTicker={market.ticker}
              marketTitle={event.title}
            />

            <div className="flex justify-between items-center pt-1">
              <PatternBadge pattern={analysis.pattern} />
              <span className="text-xs text-muted-foreground">Edge {analysis.edgeScore.toFixed(1)}</span>
            </div>
            <ActionBadge action={analysis.recommendedAction} />

            {stats && stats.state === "in" && (
              <LiveStatsBlock stats={stats} marketYesPct={yesPct} yesTeamHint={market.yesSubTitle} />
            )}

            {presets && presets.hasEdge && presets.full > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  <span className="flex items-center gap-1 text-[color:var(--color-primary)]">
                    <DollarSign className="h-3 w-3" /> Quick stake
                  </span>
                  <span>Kelly {presets.kellyPct.toFixed(0)}% · bank ${profile.bankroll}</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <PresetBetButton
                    label="¼K"
                    amount={presets.quarter}
                    game={event.title}
                    pick={`${market.yesSubTitle || "YES"} @ ${yesPct.toFixed(0)}%`}
                    sport={inferSportLabel(event.competition || event.seriesTicker || event.title)}
                    odds={market.yesPrice}
                    patternType={analysis.pattern}
                    confidence={analysis.confidenceScore}
                    edge={analysis.edgeScore}
                    notes={`Kalshi ${market.ticker} · ¼ Kelly${fv ? ` · fair ${(fv.fairProb * 100).toFixed(0)}%` : ""}`}
                  />
                  <PresetBetButton
                    label="½K"
                    amount={presets.half}
                    game={event.title}
                    pick={`${market.yesSubTitle || "YES"} @ ${yesPct.toFixed(0)}%`}
                    sport={inferSportLabel(event.competition || event.seriesTicker || event.title)}
                    odds={market.yesPrice}
                    patternType={analysis.pattern}
                    confidence={analysis.confidenceScore}
                    edge={analysis.edgeScore}
                    notes={`Kalshi ${market.ticker} · ½ Kelly${fv ? ` · fair ${(fv.fairProb * 100).toFixed(0)}%` : ""}`}
                  />
                  <PresetBetButton
                    label="1K"
                    amount={presets.full}
                    game={event.title}
                    pick={`${market.yesSubTitle || "YES"} @ ${yesPct.toFixed(0)}%`}
                    sport={inferSportLabel(event.competition || event.seriesTicker || event.title)}
                    odds={market.yesPrice}
                    patternType={analysis.pattern}
                    confidence={analysis.confidenceScore}
                    edge={analysis.edgeScore}
                    notes={`Kalshi ${market.ticker} · Full Kelly${fv ? ` · fair ${(fv.fairProb * 100).toFixed(0)}%` : ""}`}
                  />
                </div>
              </div>
            )}


            <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground gap-2">
              <span className="truncate">{market.ticker}</span>
              <div className="flex items-center gap-2 shrink-0">
                <SaveBetButton
                  game={event.title}
                  pick={`${market.yesSubTitle || "YES"} @ ${yesPct.toFixed(0)}%`}
                  sport={inferSportLabel(event.competition || event.seriesTicker || event.title)}
                  odds={market.yesPrice}
                  patternType={analysis.pattern}
                  confidence={analysis.confidenceScore}
                  edge={analysis.edgeScore}
                  stake={kelly?.stake ?? 0}
                  notes={`Kalshi ${market.ticker} · ${analysis.recommendedAction}${
                    fv ? ` · fair ${(fv.fairProb * 100).toFixed(0)}%` : ""
                  }${kelly?.stake ? ` · stake $${kelly.stake} (${profile.risk})` : ""}`}
                />
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

function LiveStatsBlock({
  stats,
  marketYesPct,
  yesTeamHint,
}: {
  stats: LiveGameStats;
  marketYesPct: number;
  yesTeamHint?: string;
}) {
  const hot = stats.comebackScore >= 60;
  const ts = stats.teamStats;
  const lean = stats.outcomeLean;
  const fv = computeFairProbability(stats, marketYesPct, yesTeamHint);
  const edgeColor =
    fv == null
      ? "text-muted-foreground"
      : fv.edgePts >= 8
        ? "text-[color:var(--color-primary)]"
        : fv.edgePts <= -8
          ? "text-[color:var(--color-destructive)]"
          : "text-muted-foreground";
  const edgeSignal =
    fv == null ? "" : fv.edgePts >= 8 ? "▲ BUY" : fv.edgePts <= -8 ? "▼ FADE" : "· HOLD";
  return (
    <div className="border border-border rounded p-2 bg-background/40 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Activity className="h-3 w-3 text-[color:var(--color-primary)]" />
        Live · {stats.shortDetail}
      </div>
      <div className="flex justify-between text-xs font-bold">
        <span>
          {stats.away.abbr} {stats.away.score}
        </span>
        <span className="text-muted-foreground">@</span>
        <span>
          {stats.home.abbr} {stats.home.score}
        </span>
      </div>
      {fv && (
        <div className="flex items-center justify-between text-[10px] font-mono border border-border/60 rounded px-1.5 py-1 bg-background/60">
          <span className="text-muted-foreground">
            Market <span className="text-foreground font-bold">{marketYesPct.toFixed(0)}%</span>
          </span>
          <span className="text-muted-foreground">
            Fair <span className="text-foreground font-bold">{(fv.fairProb * 100).toFixed(0)}%</span>
          </span>
          <span className={`font-bold uppercase tracking-widest ${edgeColor}`}>
            {fv.edgePts >= 0 ? "+" : ""}
            {fv.edgePts.toFixed(0)}pt {edgeSignal}
          </span>
        </div>
      )}
      <BookConsensusRow stats={stats} marketYesPct={marketYesPct} yesTeamHint={yesTeamHint} />
      {stats.trailingTeam && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">
            Trailing: <span className="text-foreground">{stats.trailingTeam}</span> by {stats.scoreDiff}
          </span>
          <span
            className={`flex items-center gap-1 font-bold uppercase tracking-widest ${
              hot ? "text-[color:var(--color-primary)]" : "text-muted-foreground"
            }`}
          >
            <TrendingUp className="h-3 w-3" /> Comeback {stats.comebackScore}
          </span>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground leading-tight">{stats.comebackReason}</div>
      {stats.lastPlay && <div className="text-[10px] text-muted-foreground italic truncate">"{stats.lastPlay}"</div>}

      {ts && <BoxScoreTable home={ts.home} away={ts.away} league={stats.league} />}

      {lean && lean.favored && (
        <div className="mt-1 pt-1 border-t border-border/60">
          <div className="flex items-center justify-between text-[10px]">
            <span className="uppercase tracking-widest text-muted-foreground">Outcome lean</span>
            <span className="font-bold text-[color:var(--color-primary)]">
              {lean.favored.split(" ").slice(-1)[0]} · {lean.lean}
            </span>
          </div>
          {lean.reasons.length > 0 && (
            <div className="text-[10px] text-muted-foreground leading-tight">
              {lean.reasons.join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BookConsensusRow({
  stats,
  marketYesPct,
  yesTeamHint,
}: {
  stats: LiveGameStats;
  marketYesPct: number;
  yesTeamHint?: string;
}) {
  const fn = useServerFn(getNoVigFairLine);
  const q = useQuery({
    queryKey: ["odds-novig", stats.league, stats.home.name, stats.away.name],
    queryFn: () =>
      fn({
        data: {
          league: stats.league,
          homeName: stats.home.name,
          awayName: stats.away.name,
        },
      }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });

  if (q.isLoading) {
    return (
      <div className="text-[10px] font-mono text-muted-foreground border border-border/40 rounded px-1.5 py-1 bg-background/40">
        Book consensus…
      </div>
    );
  }
  if (!q.data || !q.data.ok) return null;

  // The Odds API returns home/away probs. YES on Kalshi can be either team.
  // Use the existing teamHint to pick which side maps to YES.
  const hint = (yesTeamHint ?? "").toLowerCase();
  const homeName = stats.home.name.toLowerCase();
  const awayName = stats.away.name.toLowerCase();
  const yesIsHome =
    hint && (homeName.includes(hint) || hint.includes(stats.home.abbr.toLowerCase()));
  const yesIsAway =
    hint && (awayName.includes(hint) || hint.includes(stats.away.abbr.toLowerCase()));
  const bookYesProb = yesIsAway
    ? q.data.fairAwayProb
    : yesIsHome
      ? q.data.fairHomeProb
      : q.data.fairHomeProb;
  const bookYesPct = bookYesProb * 100;
  const edge = bookYesPct - marketYesPct;
  const edgeColor =
    edge >= 5
      ? "text-[color:var(--color-primary)]"
      : edge <= -5
        ? "text-[color:var(--color-destructive)]"
        : "text-muted-foreground";

  return (
    <div
      title={`No-vig consensus from ${q.data.books.length} book${
        q.data.books.length === 1 ? "" : "s"
      } · avg vig ${q.data.avgVigPct.toFixed(2)}%`}
      className="flex items-center justify-between text-[10px] font-mono border border-border/60 rounded px-1.5 py-1 bg-background/60"
    >
      <span className="text-muted-foreground uppercase tracking-widest">
        Book ({q.data.books.length})
      </span>
      <span className="text-muted-foreground">
        Fair <span className="text-foreground font-bold">{bookYesPct.toFixed(0)}%</span>
      </span>
      <span className={`font-bold uppercase tracking-widest ${edgeColor}`}>
        {edge >= 0 ? "+" : ""}
        {edge.toFixed(0)}pt vs mkt
      </span>
    </div>
  );
}



function BoxScoreTable({
  home,
  away,
  league,
}: {
  home: import("@/lib/espn.functions").TeamStatLine;
  away: import("@/lib/espn.functions").TeamStatLine;
  league: LiveGameStats["league"];
}) {
  const rows: Array<{ label: string; a?: number; h?: number; pct?: boolean }> = [];
  if (league.startsWith("basketball")) {
    rows.push({ label: "FG%", a: away.fgPct, h: home.fgPct, pct: true });
    rows.push({ label: "3P%", a: away.threePct, h: home.threePct, pct: true });
    rows.push({ label: "FT%", a: away.ftPct, h: home.ftPct, pct: true });
    rows.push({ label: "REB", a: away.rebounds, h: home.rebounds });
    rows.push({ label: "AST", a: away.assists, h: home.assists });
    rows.push({ label: "TO", a: away.turnovers, h: home.turnovers });
    rows.push({ label: "PIP", a: away.pointsInPaint, h: home.pointsInPaint });
    rows.push({ label: "PTS off TO", a: away.pointsOffTurnovers, h: home.pointsOffTurnovers });
  } else if (league.startsWith("hockey")) {
    rows.push({ label: "Shots", a: away.shots, h: home.shots });
    rows.push({ label: "Hits", a: away.hits, h: home.hits });
    rows.push({ label: "FO%", a: away.faceoffPct, h: home.faceoffPct, pct: true });
    rows.push({ label: "PP%", a: away.ppPct, h: home.ppPct, pct: true });
  }
  const visible = rows.filter((r) => r.a != null || r.h != null);
  if (visible.length === 0) return null;
  const fmt = (v?: number, pct?: boolean) => (v == null ? "—" : pct ? `${v.toFixed(1)}%` : String(v));
  return (
    <div className="mt-1 pt-1 border-t border-border/60">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 text-[10px]">
        <div className="text-right font-bold text-muted-foreground">{away.abbr}</div>
        <div className="text-center uppercase tracking-widest text-muted-foreground">Stat</div>
        <div className="text-left font-bold text-muted-foreground">{home.abbr}</div>
        {visible.map((r) => {
          const aWin = r.a != null && r.h != null && (r.label === "TO" ? r.a < r.h : r.a > r.h);
          const hWin = r.a != null && r.h != null && (r.label === "TO" ? r.h < r.a : r.h > r.a);
          return (
            <Fragment key={r.label}>
              <div className={`text-right ${aWin ? "text-[color:var(--color-primary)] font-bold" : ""}`}>
                {fmt(r.a, r.pct)}
              </div>
              <div className="text-center text-muted-foreground">{r.label}</div>
              <div className={`text-left ${hWin ? "text-[color:var(--color-primary)] font-bold" : ""}`}>
                {fmt(r.h, r.pct)}
              </div>
            </Fragment>
          );
        })}
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

function inferSportLabel(hint: string): string {
  const h = hint.toLowerCase();
  if (/wnba/.test(h)) return "WNBA";
  if (/nba|basketball/.test(h)) return "NBA";
  if (/nfl|football/.test(h)) return "NFL";
  if (/mlb|baseball/.test(h)) return "MLB";
  if (/nhl|hockey/.test(h)) return "NHL";
  if (/soccer|mls|epl|ucl|serie|liga|bundes/.test(h)) return "Soccer";
  if (/tennis|atp|wta|open/.test(h)) return "Tennis";
  if (/golf|pga|masters/.test(h)) return "Golf";
  return "Other";
}

// Kalshi event sub_title looks like "CAR at MTL (May 23)" or "Carolina at Montreal".
// Pull the two sides so ESPN can match a real live game.
function parseTeamsFromEvent(
  subTitle: string,
  title: string,
  yesSubTitle: string,
): { a: string; b: string | undefined } {
  const src = subTitle || title || "";
  // Strip trailing parenthetical date.
  const cleaned = src.replace(/\([^)]*\)\s*$/, "").trim();
  const m = cleaned.match(/^(.+?)\s+(?:at|vs\.?|@|v\.?)\s+(.+?)$/i);
  if (m) {
    const left = m[1].trim();
    const right = m[2].trim();
    if (left && right) return { a: left, b: right };
  }
  return { a: yesSubTitle || title || src, b: undefined };
}

function SaveBetButton(props: {
  game: string;
  pick: string;
  sport: string;
  odds: number;
  patternType: string;
  confidence: number;
  edge: number;
  stake?: number;
  notes: string;
}) {
  const saveFn = useServerFn(saveBetFromMarket);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const onClick = async () => {
    if (state !== "idle") return;
    setState("saving");
    try {
      const res = await saveFn({
        data: {
          game: props.game,
          pick: props.pick,
          sport: props.sport,
          odds: props.odds,
          pattern_type: props.patternType,
          confidence_score: props.confidence,
          edge_score: props.edge,
          stake: props.stake,
          notes: props.notes,
        },
      });
      setState("saved");
      toast.success(
        res.linkedAnalysisId ? "Saved to Bets · linked to latest analysis" : "Saved to Bets",
      );
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      setState("idle");
      toast.error((e as Error).message || "Failed to save bet");
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={state !== "idle"}
      className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] uppercase tracking-widest transition-colors ${
        state === "saved"
          ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
          : "border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      }`}
    >
      {state === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : state === "saved" ? (
        <Check className="h-3 w-3" />
      ) : (
        <BookmarkPlus className="h-3 w-3" />
      )}
      {state === "saved" ? "Saved" : "Save bet"}
    </button>
  );
}

function BankrollChip(props: {
  bankroll: number;
  openStake: number;
  openCount: number;
  realized: number;
  settledCount: number;
}) {
  const plTone =
    props.realized > 0
      ? "text-emerald-400"
      : props.realized < 0
        ? "text-[color:var(--color-destructive)]"
        : "text-muted-foreground";
  const plSign = props.realized > 0 ? "+" : "";
  return (
    <Link
      to="/settings"
      className="flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-widest rounded border border-border bg-card hover:border-[color:var(--color-primary)] font-mono"
      title="Bankroll · Open stake · Realized P/L (click to edit bankroll in Settings)"
    >
      <span className="flex items-center gap-1">
        <DollarSign className="h-3 w-3 text-[color:var(--color-primary)]" />
        <span className="text-muted-foreground">Bank</span>
        <span className="font-bold text-foreground">${props.bankroll.toLocaleString()}</span>
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="text-muted-foreground">Open</span>{" "}
        <span className="font-bold text-foreground">${Math.round(props.openStake).toLocaleString()}</span>
        <span className="text-muted-foreground"> ({props.openCount})</span>
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="text-muted-foreground">P/L</span>{" "}
        <span className={`font-bold ${plTone}`}>{plSign}${Math.round(props.realized).toLocaleString()}</span>
      </span>
    </Link>
  );
}

function PresetBetButton(props: {
  label: string;
  amount: number;
  game: string;
  pick: string;
  sport: string;
  odds: number;
  patternType: string;
  confidence: number;
  edge: number;
  notes: string;
}) {
  const saveFn = useServerFn(saveBetFromMarket);
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const disabled = state !== "idle" || props.amount <= 0;

  const onClick = async () => {
    if (disabled) return;
    setState("saving");
    try {
      await saveFn({
        data: {
          game: props.game,
          pick: props.pick,
          sport: props.sport,
          odds: props.odds,
          pattern_type: props.patternType,
          confidence_score: props.confidence,
          edge_score: props.edge,
          stake: props.amount,
          notes: `${props.notes} · stake $${props.amount}`,
        },
      });
      setState("saved");
      toast.success(`Saved ${props.label} · $${props.amount}`);
      qc.invalidateQueries({ queryKey: ["bankroll-stats"] });
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setState("idle");
      toast.error((e as Error).message || "Save failed");
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-0 py-1 rounded border text-[10px] font-mono uppercase tracking-widest transition-colors ${
        state === "saved"
          ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
          : props.amount <= 0
            ? "border-border text-muted-foreground opacity-40"
            : "border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      }`}
    >
      <span className="font-bold">
        {state === "saving" ? "…" : state === "saved" ? "✓" : props.label}
      </span>
      <span className="text-[9px]">${props.amount}</span>
    </button>
  );
}

