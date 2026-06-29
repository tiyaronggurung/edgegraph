// Opta (Stats Perform) live soccer provider stub.
// Implements LiveDataProvider so the rest of the engine never knows which feed it's reading.
// Activates when OPTA_API_KEY + OPTA_OUTLET_AUTH_KEY are set AND LIVE_PROVIDER=opta.
// Docs: https://documentation.statsperform.com/

import type {
  LiveDataProvider,
  LiveMatchSnapshot,
  TeamLiveStats,
  LiveMatchEvent,
} from "./liveProvider";

const BASE = "https://api.performfeeds.com/soccerdata";

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

// Opta MA3 returns aggregated per-team statistics keyed by `type`.
// Each entry is `{ type: 'totalShots', value: 12, ... }`. Fold into our shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTeamStats(items: any[] | undefined): TeamLiveStats {
  if (!items?.length) return emptyStats();
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.type && it.value != null) m.set(it.type, Number(it.value));
  }
  const pick = (k: string) => (m.has(k) ? (m.get(k) as number) : null);
  return {
    shots: pick("totalShots"),
    shotsOnTarget: pick("shotsOnTarget"),
    possession: pick("possessionPercentage"),
    corners: pick("cornersTotal"),
    fouls: pick("fkFoul"),
    attacks: null,
    dangerousAttacks: null,
    yellowCards: pick("totalYelCard"),
    redCards: pick("totalRedCard"),
    expectedGoals: pick("expectedGoals"),
    offsides: pick("totalOffside"),
    saves: pick("saves"),
    passesAccurate: pick("accuratePass"),
    passesPct: pick("passAccuracy"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any, homeContestantId: string): LiveMatchEvent {
  const team = e?.contestantId === homeContestantId ? "home" : "away";
  let type: LiveMatchEvent["type"] = "Other";
  if (e.typeId === 16) type = "Goal";
  else if (e.typeId === 17) type = "Card";
  else if (e.typeId === 18) type = "subst";
  else if (e.typeId === 71) type = "Var";
  return {
    minute: e.timeMin ?? 0,
    type,
    detail: e.type ?? String(e.typeId ?? ""),
    team,
    player: e.playerName ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMatch(match: any, stats: any): LiveMatchSnapshot | null {
  const info = match.matchInfo ?? match;
  const liveData = match.liveData ?? match;
  const contestants = info.contestant ?? [];
  const home = contestants.find((c: { position: string }) => c.position === "home");
  const away = contestants.find((c: { position: string }) => c.position === "away");
  if (!home || !away) return null;

  const statsByTeam: Record<string, unknown[]> = {};
  const lineUps = stats?.liveData?.lineUp ?? [];
  for (const lu of lineUps) {
    statsByTeam[lu.contestantId] = lu.stat ?? [];
  }

  const matchDetails = liveData.matchDetails ?? {};
  return {
    providerId: "opta",
    fixtureId: String(info.id),
    status: matchDetails.matchStatus ?? "Pending",
    elapsed: liveData.matchDetailsLive?.lastUpdated ? matchDetails.period ?? null : null,
    injuryTime: null,
    league: info.competition?.name ?? "",
    country: info.competition?.country?.name ?? "",
    homeTeam: home.name,
    awayTeam: away.name,
    homeId: home.id,
    awayId: away.id,
    goalsHome: matchDetails.scores?.total?.home ?? 0,
    goalsAway: matchDetails.scores?.total?.away ?? 0,
    home: mapTeamStats(statsByTeam[home.id] as never),
    away: mapTeamStats(statsByTeam[away.id] as never),
    events: (liveData.event ?? []).map((e: unknown) => mapEvent(e, home.id)),
  };
}

export class OptaProvider implements LiveDataProvider {
  readonly id = "opta";

  private async request(feed: string, params: Record<string, string>) {
    const apiKey = process.env.OPTA_API_KEY;
    const outletAuthKey = process.env.OPTA_OUTLET_AUTH_KEY;
    if (!apiKey || !outletAuthKey) {
      throw new Error(
        "OPTA_API_KEY + OPTA_OUTLET_AUTH_KEY not set. Add both and set LIVE_PROVIDER=opta.",
      );
    }
    const qs = new URLSearchParams({ _rt: "b", _fmt: "json", ...params }).toString();
    const url = `${BASE}/${feed}/${outletAuthKey}?${qs}`;
    const res = await fetch(url, {
      headers: { "X-Auth-Token": apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Opta ${feed} → HTTP ${res.status}`);
    return res.json();
  }

  async fetchLive(): Promise<LiveMatchSnapshot[]> {
    // MA1 = match list (live + recent); status filter narrows to in-play.
    const j = await this.request("match/", { live: "yes" });
    const matches = (j?.match ?? []) as unknown[];
    // For full stats we'd need MA3 per match — keep light here, the worker calls fetchMatch per fixture.
    return matches
      .map((m) => mapMatch(m, {}))
      .filter((m): m is LiveMatchSnapshot => m !== null);
  }

  async fetchMatch(fixtureId: string): Promise<LiveMatchSnapshot | null> {
    // MA3 = match stats; MA2 = match facts. Fetch both and merge.
    const [stats, facts] = await Promise.all([
      this.request("matchstats/", { fx: fixtureId }),
      this.request("matchfacts/", { fx: fixtureId }),
    ]);
    const match = facts?.match?.[0] ?? stats?.match?.[0];
    if (!match) return null;
    return mapMatch(match, stats?.match?.[0] ?? {});
  }
}
