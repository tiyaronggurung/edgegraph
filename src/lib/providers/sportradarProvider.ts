// Sportradar live soccer provider stub.
// Implements LiveDataProvider so the rest of the engine never knows which feed it's reading.
// Activates when SPORTRADAR_API_KEY is set AND LIVE_PROVIDER=sportradar.
// Docs: https://developer.sportradar.com/docs/read/soccer/Soccer_v4

import type {
  LiveDataProvider,
  LiveMatchSnapshot,
  TeamLiveStats,
  LiveMatchEvent,
} from "./liveProvider";

const BASE = "https://api.sportradar.com/soccer/trial/v4/en";

function emptyStats(): TeamLiveStats {
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

// Sportradar statistics use snake_case keys, but the field set differs from API-Football.
// This helper takes Sportradar's per-team `statistics` object and folds it into our shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTeamStats(s: any): TeamLiveStats {
  if (!s) return emptyStats();
  return {
    shots: s.shots_total ?? null,
    shotsOnTarget: s.shots_on_target ?? null,
    possession: s.ball_possession ?? null,
    corners: s.corner_kicks ?? null,
    fouls: s.fouls ?? null,
    attacks: null,
    dangerousAttacks: null,
    yellowCards: s.yellow_cards ?? null,
    redCards: s.red_cards ?? null,
    expectedGoals: null, // Sportradar xG ships in a separate xG add-on.
    offsides: s.offsides ?? null,
    saves: s.goalkeeper_saves ?? null,
    passesAccurate: s.passes_completed ?? null,
    passesPct:
      s.passes_total && s.passes_completed
        ? Math.round((s.passes_completed / s.passes_total) * 100)
        : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any, homeId: string): LiveMatchEvent {
  const teamId = e?.competitor?.id ?? e?.team?.id ?? "";
  const team = teamId === homeId ? "home" : "away";
  let type: LiveMatchEvent["type"] = "Other";
  if (e.type === "score_change" || e.type === "goal_scored") type = "Goal";
  else if (e.type === "yellow_card" || e.type === "red_card") type = "Card";
  else if (e.type === "substitution") type = "subst";
  else if (e.type?.startsWith("video_assistant")) type = "Var";
  return {
    minute: e.match_time ?? e.minute ?? 0,
    type,
    detail: e.type ?? "",
    team,
    player: e.players?.[0]?.name ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMatch(m: any): LiveMatchSnapshot | null {
  const sportEvent = m.sport_event ?? m;
  const competitors = sportEvent.competitors ?? [];
  const home = competitors.find((c: { qualifier: string }) => c.qualifier === "home");
  const away = competitors.find((c: { qualifier: string }) => c.qualifier === "away");
  if (!home || !away) return null;
  const status = m.sport_event_status ?? {};
  const statsList = m.statistics?.totals?.competitors ?? [];
  const homeStats = mapTeamStats(statsList.find((c: { id: string }) => c.id === home.id)?.statistics);
  const awayStats = mapTeamStats(statsList.find((c: { id: string }) => c.id === away.id)?.statistics);
  const events = (m.timeline ?? []).map((e: unknown) => mapEvent(e, home.id));

  return {
    providerId: "sportradar",
    fixtureId: String(sportEvent.id),
    status: status.match_status ?? status.status ?? "not_started",
    elapsed: status.clock?.played_minutes ?? null,
    injuryTime: null,
    league: sportEvent.tournament?.name ?? "",
    country: sportEvent.tournament?.category?.name ?? "",
    homeTeam: home.name,
    awayTeam: away.name,
    homeId: home.id,
    awayId: away.id,
    goalsHome: status.home_score ?? 0,
    goalsAway: status.away_score ?? 0,
    home: homeStats,
    away: awayStats,
    events,
  };
}

export class SportradarProvider implements LiveDataProvider {
  readonly id = "sportradar";

  private async request(path: string) {
    const key = process.env.SPORTRADAR_API_KEY;
    if (!key) {
      throw new Error(
        "SPORTRADAR_API_KEY not set. Add the key and set LIVE_PROVIDER=sportradar to activate.",
      );
    }
    const res = await fetch(`${BASE}${path}?api_key=${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Sportradar ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async fetchLive(): Promise<LiveMatchSnapshot[]> {
    const j = await this.request(`/schedules/live/summaries.json`);
    const list = (j?.summaries ?? []) as unknown[];
    return list
      .map((m) => mapMatch(m))
      .filter((m): m is LiveMatchSnapshot => m !== null);
  }

  async fetchMatch(fixtureId: string): Promise<LiveMatchSnapshot | null> {
    const j = await this.request(`/sport_events/${encodeURIComponent(fixtureId)}/summary.json`);
    return mapMatch(j);
  }
}
