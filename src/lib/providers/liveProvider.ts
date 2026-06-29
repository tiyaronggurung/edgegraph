// Provider-agnostic interface for live match data.
// Any provider (API-Football, Sportradar, Opta, StatsBomb) implements this.

export interface TeamLiveStats {
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
  offsides: number | null;
  saves: number | null;
  passesAccurate: number | null;
  passesPct: number | null;
}

export interface LiveMatchEvent {
  minute: number;
  type: "Goal" | "Card" | "subst" | "Var" | "Other";
  detail: string;
  team: "home" | "away";
  player: string | null;
}

export interface LiveMatchSnapshot {
  providerId: string; // provider name e.g. "api-football"
  fixtureId: string; // stringified for provider-agnosticism
  status: string; // "1H" | "HT" | "2H" | "ET" | "FT" | ...
  elapsed: number | null;
  injuryTime: number | null;
  league: string;
  country: string;
  homeTeam: string;
  awayTeam: string;
  homeId: string;
  awayId: string;
  goalsHome: number;
  goalsAway: number;
  home: TeamLiveStats;
  away: TeamLiveStats;
  events: LiveMatchEvent[];
}

export interface LiveDataProvider {
  readonly id: string;
  /** Fetch all currently-live matches, with stats + events when available. */
  fetchLive(): Promise<LiveMatchSnapshot[]>;
  /** Fetch a single match by fixture id. */
  fetchMatch(fixtureId: string): Promise<LiveMatchSnapshot | null>;
}
