import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Simple in-process cache to respect API-Football rate limits.
// 60s TTL: with 6 matches polled ~ every 60s that's <100 req/day for fixtures.
const CACHE_TTL_MS = 60_000;
let liveCache: { ts: number; data: LiveMatchStats[] } | null = null;
const statsCache = new Map<number, { ts: number; data: MatchStats | null }>();

export interface LiveMatchStats {
  fixtureId: number;
  status: string; // e.g. "1H", "HT", "2H", "ET", "FT"
  elapsed: number | null;
  homeTeam: string;
  awayTeam: string;
  homeId: number;
  awayId: number;
  league: string;
  goalsHome: number;
  goalsAway: number;
}

export interface TeamStats {
  shots: number | null;
  shotsOnTarget: number | null;
  possession: number | null; // 0..100
  corners: number | null;
  fouls: number | null;
  attacks: number | null;
  dangerousAttacks: number | null;
  yellowCards: number | null;
  redCards: number | null;
  expectedGoals: number | null;
}

export interface MatchStats {
  fixtureId: number;
  home: TeamStats;
  away: TeamStats;
}

function parseStatVal(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace("%", "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapTeamStats(items: Array<{ type: string; value: unknown }> | undefined): TeamStats {
  const lookup = new Map<string, unknown>();
  for (const it of items ?? []) lookup.set(it.type.toLowerCase(), it.value);
  return {
    shots: parseStatVal(lookup.get("total shots")) ?? parseStatVal(lookup.get("shots total")),
    shotsOnTarget: parseStatVal(lookup.get("shots on goal")),
    possession: parseStatVal(lookup.get("ball possession")),
    corners: parseStatVal(lookup.get("corner kicks")),
    fouls: parseStatVal(lookup.get("fouls")),
    attacks: parseStatVal(lookup.get("attacks")),
    dangerousAttacks: parseStatVal(lookup.get("dangerous attacks")),
    yellowCards: parseStatVal(lookup.get("yellow cards")),
    redCards: parseStatVal(lookup.get("red cards")),
    expectedGoals: parseStatVal(lookup.get("expected_goals")) ?? parseStatVal(lookup.get("expected goals")),
  };
}

async function apiFootball<T = unknown>(path: string): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY not configured");
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-apisports-key": key },
  });
  if (!res.ok) throw new Error(`api-football ${res.status}`);
  return (await res.json()) as T;
}

export const getLiveSoccerFixtures = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ matches: LiveMatchStats[]; error: string | null }> => {
    try {
      if (liveCache && Date.now() - liveCache.ts < CACHE_TTL_MS) {
        return { matches: liveCache.data, error: null };
      }
      const json = await apiFootball<{ response: any[] }>("/fixtures?live=all");
      const matches: LiveMatchStats[] = (json.response ?? []).map((f) => ({
        fixtureId: f.fixture?.id,
        status: f.fixture?.status?.short ?? "",
        elapsed: f.fixture?.status?.elapsed ?? null,
        homeTeam: f.teams?.home?.name ?? "",
        awayTeam: f.teams?.away?.name ?? "",
        homeId: f.teams?.home?.id ?? 0,
        awayId: f.teams?.away?.id ?? 0,
        league: f.league?.name ?? "",
        goalsHome: f.goals?.home ?? 0,
        goalsAway: f.goals?.away ?? 0,
      }));
      liveCache = { ts: Date.now(), data: matches };
      return { matches, error: null };
    } catch (e) {
      console.error("getLiveSoccerFixtures failed", e);
      return { matches: [], error: e instanceof Error ? e.message : "Unknown" };
    }
  },
);

export const getMatchStats = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fixtureId: z.number().int().positive() }).parse(d))
  .handler(async ({ data }): Promise<{ stats: MatchStats | null; error: string | null }> => {
    try {
      const cached = statsCache.get(data.fixtureId);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        return { stats: cached.data, error: null };
      }
      const json = await apiFootball<{ response: any[] }>(
        `/fixtures/statistics?fixture=${data.fixtureId}`,
      );
      const resp = json.response ?? [];
      if (resp.length < 2) {
        statsCache.set(data.fixtureId, { ts: Date.now(), data: null });
        return { stats: null, error: null };
      }
      const stats: MatchStats = {
        fixtureId: data.fixtureId,
        home: mapTeamStats(resp[0]?.statistics),
        away: mapTeamStats(resp[1]?.statistics),
      };
      statsCache.set(data.fixtureId, { ts: Date.now(), data: stats });
      return { stats, error: null };
    } catch (e) {
      console.error("getMatchStats failed", e);
      return { stats: null, error: e instanceof Error ? e.message : "Unknown" };
    }
  });
