// API-Football implementation of LiveDataProvider.
// Server-only: reads process.env.API_FOOTBALL_KEY. Do not import from client.

import type {
  LiveDataProvider,
  LiveMatchEvent,
  LiveMatchSnapshot,
  TeamLiveStats,
} from "./liveProvider";

const BASE = "https://v3.football.api-sports.io";

// In-process cache. Multiple instances per worker share — best-effort.
const TTL_LIVE_MS = 30_000;
const TTL_STATS_MS = 30_000;
const TTL_EVENTS_MS = 30_000;
let liveCache: { ts: number; data: LiveMatchSnapshot[] } | null = null;
const statsCache = new Map<string, { ts: number; data: any[] }>();
const eventsCache = new Map<string, { ts: number; data: any[] }>();

function num(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw.replace("%", "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapTeamStats(items: Array<{ type: string; value: unknown }> | undefined): TeamLiveStats {
  const m = new Map<string, unknown>();
  for (const it of items ?? []) m.set(it.type.toLowerCase(), it.value);
  return {
    shots: num(m.get("total shots")) ?? num(m.get("shots total")),
    shotsOnTarget: num(m.get("shots on goal")),
    possession: num(m.get("ball possession")),
    corners: num(m.get("corner kicks")),
    fouls: num(m.get("fouls")),
    attacks: num(m.get("attacks")),
    dangerousAttacks: num(m.get("dangerous attacks")),
    yellowCards: num(m.get("yellow cards")),
    redCards: num(m.get("red cards")),
    expectedGoals: num(m.get("expected_goals")) ?? num(m.get("expected goals")),
    offsides: num(m.get("offsides")),
    saves: num(m.get("goalkeeper saves")),
    passesAccurate: num(m.get("passes accurate")),
    passesPct: num(m.get("passes %")),
  };
}

function mapEvents(raw: any[], homeId: string): LiveMatchEvent[] {
  return (raw ?? [])
    .map((e) => {
      const t = String(e.type ?? "");
      const type: LiveMatchEvent["type"] =
        t === "Goal" ? "Goal" : t === "Card" ? "Card" : t === "subst" ? "subst" : t === "Var" ? "Var" : "Other";
      return {
        minute: Number(e.time?.elapsed ?? 0) + Number(e.time?.extra ?? 0),
        type,
        detail: String(e.detail ?? ""),
        team: String(e.team?.id ?? "") === homeId ? "home" : "away",
        player: e.player?.name ?? null,
      } as LiveMatchEvent;
    })
    .sort((a, b) => a.minute - b.minute);
}

async function af<T = any>(path: string): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY not configured");
  const res = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`api-football ${res.status} ${path}`);
  return (await res.json()) as T;
}

export class ApiFootballProvider implements LiveDataProvider {
  readonly id = "api-football";

  async fetchLive(): Promise<LiveMatchSnapshot[]> {
    if (liveCache && Date.now() - liveCache.ts < TTL_LIVE_MS) return liveCache.data;

    const fixtures = await af<{ response: any[] }>("/fixtures?live=all");
    const matches: LiveMatchSnapshot[] = (fixtures.response ?? []).map((f) => ({
      providerId: this.id,
      fixtureId: String(f.fixture?.id ?? ""),
      status: f.fixture?.status?.short ?? "",
      elapsed: f.fixture?.status?.elapsed ?? null,
      injuryTime: f.fixture?.status?.extra ?? null,
      league: f.league?.name ?? "",
      country: f.league?.country ?? "",
      homeTeam: f.teams?.home?.name ?? "",
      awayTeam: f.teams?.away?.name ?? "",
      homeId: String(f.teams?.home?.id ?? ""),
      awayId: String(f.teams?.away?.id ?? ""),
      goalsHome: f.goals?.home ?? 0,
      goalsAway: f.goals?.away ?? 0,
      home: emptyTeamStats(),
      away: emptyTeamStats(),
      events: [],
    }));

    liveCache = { ts: Date.now(), data: matches };
    return matches;
  }

  async fetchMatch(fixtureId: string): Promise<LiveMatchSnapshot | null> {
    const live = await this.fetchLive();
    const base = live.find((m) => m.fixtureId === fixtureId);
    if (!base) return null;

    const [statsResp, evResp] = await Promise.all([
      this.fetchStats(fixtureId),
      this.fetchEvents(fixtureId),
    ]);

    if (statsResp.length >= 2) {
      const homeBlock = statsResp.find((s) => String(s.team?.id ?? "") === base.homeId) ?? statsResp[0];
      const awayBlock = statsResp.find((s) => String(s.team?.id ?? "") === base.awayId) ?? statsResp[1];
      base.home = mapTeamStats(homeBlock?.statistics);
      base.away = mapTeamStats(awayBlock?.statistics);
    }
    base.events = mapEvents(evResp, base.homeId);
    return base;
  }

  private async fetchStats(fixtureId: string): Promise<any[]> {
    const c = statsCache.get(fixtureId);
    if (c && Date.now() - c.ts < TTL_STATS_MS) return c.data;
    const json = await af<{ response: any[] }>(`/fixtures/statistics?fixture=${fixtureId}`);
    const data = json.response ?? [];
    statsCache.set(fixtureId, { ts: Date.now(), data });
    return data;
  }

  private async fetchEvents(fixtureId: string): Promise<any[]> {
    const c = eventsCache.get(fixtureId);
    if (c && Date.now() - c.ts < TTL_EVENTS_MS) return c.data;
    const json = await af<{ response: any[] }>(`/fixtures/events?fixture=${fixtureId}`);
    const data = json.response ?? [];
    eventsCache.set(fixtureId, { ts: Date.now(), data });
    return data;
  }
}

export function emptyTeamStats(): TeamLiveStats {
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
    offsides: null,
    saves: null,
    passesAccurate: null,
    passesPct: null,
  };
}
