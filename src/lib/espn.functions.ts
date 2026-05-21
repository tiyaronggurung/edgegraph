// ESPN public scoreboard — no API key required.
// Maps Kalshi sports markets to live game state for comeback prediction.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

export type EspnLeague =
  | "basketball/nba"
  | "basketball/wnba"
  | "basketball/mens-college-basketball"
  | "football/nfl"
  | "football/college-football"
  | "baseball/mlb"
  | "hockey/nhl"
  | "soccer/all";

export interface TeamStatLine {
  name: string;
  abbr: string;
  homeAway: "home" | "away";
  score: number;
  // Common (NBA/WNBA) — null if not applicable to the league
  fgPct?: number;
  threePct?: number;
  ftPct?: number;
  rebounds?: number;
  offReb?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  pointsInPaint?: number;
  fastBreakPoints?: number;
  pointsOffTurnovers?: number;
  largestLead?: number;
  // Hockey
  shots?: number;
  hits?: number;
  faceoffPct?: number;
  ppPct?: number;
  // Generic catch-all
  extras?: Record<string, string>;
}

export interface OutcomeLean {
  favored: string | null; // team name
  lean: number; // 0..100 confidence toward favored side
  reasons: string[];
}

export interface LiveGameStats {
  league: EspnLeague;
  eventId: string;
  state: "pre" | "in" | "post";
  shortDetail: string;
  period: number;
  clock: string;
  home: { name: string; abbr: string; score: number };
  away: { name: string; abbr: string; score: number };
  trailingTeam: string | null;
  scoreDiff: number;
  possession?: string;
  lastPlay?: string;
  comebackScore: number; // 0..100 — how plausible a comeback by the trailing side
  comebackReason: string;
  teamStats?: { home: TeamStatLine; away: TeamStatLine };
  outcomeLean?: OutcomeLean;
}

function leagueFromHint(hint: string): EspnLeague[] {
  const h = hint.toLowerCase();
  if (h.includes("nba") || h.includes("basketball")) return ["basketball/nba", "basketball/wnba"];
  if (h.includes("wnba")) return ["basketball/wnba"];
  if (h.includes("ncaab") || h.includes("college basketball")) return ["basketball/mens-college-basketball"];
  if (h.includes("nfl") || h.includes("football")) return ["football/nfl"];
  if (h.includes("mlb") || h.includes("baseball")) return ["baseball/mlb"];
  if (h.includes("nhl") || h.includes("hockey")) return ["hockey/nhl"];
  if (h.includes("soccer") || h.includes("mls") || h.includes("serie") || h.includes("epl") || h.includes("ucl"))
    return ["soccer/all"];
  // Default: try the big ones in order.
  return ["basketball/nba", "baseball/mlb", "hockey/nhl", "football/nfl"];
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function teamMatches(needle: string, name: string, abbr: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  const candidates = [norm(name), norm(abbr)];
  return candidates.some((c) => c && (c === n || c.includes(n) || n.includes(c)));
}

function computeComeback(opts: {
  league: EspnLeague;
  state: string;
  period: number;
  clock: string;
  scoreDiff: number;
  totalProgressPct: number; // 0..100 how much of the game is done
}): { score: number; reason: string } {
  if (opts.state !== "in") return { score: 0, reason: "Game not in progress." };
  const diff = Math.abs(opts.scoreDiff);
  const remaining = Math.max(0, 100 - opts.totalProgressPct);
  // Bigger remaining time + smaller deficit = higher comeback plausibility.
  let score = Math.round(Math.max(0, Math.min(100, remaining * 0.9 - diff * 3)));
  let reason = "";
  if (diff <= 3 && remaining < 20) {
    score = Math.max(score, 70);
    reason = "One-possession game in crunch time — high comeback variance.";
  } else if (diff >= 15 && remaining < 25) {
    score = Math.min(score, 15);
    reason = "Large deficit with little time left.";
  } else if (diff <= 7 && remaining > 25) {
    reason = "Single-digit deficit with material time left — comeback live.";
  } else {
    reason = `Deficit ${diff} pts/runs with ~${remaining.toFixed(0)}% of game remaining.`;
  }
  return { score, reason };
}

async function fetchScoreboard(league: EspnLeague): Promise<any[]> {
  try {
    const res = await fetch(`${ESPN}/${league}/scoreboard`, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = await res.json();
    return json.events ?? [];
  } catch {
    return [];
  }
}

function progressPctForLeague(league: EspnLeague, period: number, clock: string): number {
  const [m, s] = clock.split(":").map((v) => Number(v) || 0);
  const clockSec = m * 60 + s;
  switch (league) {
    case "basketball/nba":
    case "basketball/wnba":
    case "basketball/mens-college-basketball": {
      const perLen = league === "basketball/mens-college-basketball" ? 20 * 60 : 12 * 60;
      const totalPeriods = league === "basketball/mens-college-basketball" ? 2 : 4;
      const done = Math.max(0, (period - 1)) * perLen + (perLen - clockSec);
      return Math.min(100, (done / (perLen * totalPeriods)) * 100);
    }
    case "football/nfl":
    case "football/college-football": {
      const perLen = 15 * 60;
      const done = Math.max(0, (period - 1)) * perLen + (perLen - clockSec);
      return Math.min(100, (done / (perLen * 4)) * 100);
    }
    case "hockey/nhl": {
      const perLen = 20 * 60;
      const done = Math.max(0, (period - 1)) * perLen + (perLen - clockSec);
      return Math.min(100, (done / (perLen * 3)) * 100);
    }
    case "baseball/mlb":
      // period = inning, no clock
      return Math.min(100, (period / 9) * 100);
    case "soccer/all": {
      // clock usually like "67'"
      const min = Number((clock.match(/\d+/) ?? ["0"])[0]);
      return Math.min(100, (min / 90) * 100);
    }
  }
}

// ESPN summary endpoint — returns team box score stats.
async function fetchSummary(league: EspnLeague, eventId: string): Promise<any | null> {
  try {
    const res = await fetch(`${ESPN}/${league}/summary?event=${encodeURIComponent(eventId)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function pickNum(stats: any[], names: string[]): number | undefined {
  for (const n of names) {
    const s = stats.find((x) => x?.name === n);
    if (s && s.displayValue != null && s.displayValue !== "") {
      const v = Number(String(s.displayValue).replace("%", ""));
      if (Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

function buildTeamStatLine(
  base: { name: string; abbr: string; homeAway: "home" | "away"; score: number },
  raw: any[],
): TeamStatLine {
  const line: TeamStatLine = { ...base };
  line.fgPct = pickNum(raw, ["fieldGoalPct", "fieldGoalsPct"]);
  line.threePct = pickNum(raw, ["threePointFieldGoalPct", "threePointPct"]);
  line.ftPct = pickNum(raw, ["freeThrowPct"]);
  line.rebounds = pickNum(raw, ["totalRebounds", "rebounds"]);
  line.offReb = pickNum(raw, ["offensiveRebounds"]);
  line.assists = pickNum(raw, ["assists"]);
  line.steals = pickNum(raw, ["steals"]);
  line.blocks = pickNum(raw, ["blocks", "blockedShots"]);
  line.turnovers = pickNum(raw, ["turnovers", "totalTurnovers"]);
  line.pointsInPaint = pickNum(raw, ["pointsInPaint"]);
  line.fastBreakPoints = pickNum(raw, ["fastBreakPoints"]);
  line.pointsOffTurnovers = pickNum(raw, ["pointsOffTurnovers"]);
  line.largestLead = pickNum(raw, ["largestLead"]);
  line.shots = pickNum(raw, ["shotsTotal", "shots"]);
  line.hits = pickNum(raw, ["hits"]);
  line.faceoffPct = pickNum(raw, ["faceoffPercent", "faceoffWinPercent"]);
  line.ppPct = pickNum(raw, ["powerPlayPct"]);
  return line;
}

// Predict who closes out the game based on team-stat differentials + live score state.
function computeOutcomeLean(
  league: EspnLeague,
  home: TeamStatLine,
  away: TeamStatLine,
  scoreDiff: number, // home - away
  progressPct: number,
): OutcomeLean {
  const reasons: string[] = [];
  let homeScore = 0; // positive = leans home

  // Score-state weight grows with game progress.
  const stateWeight = 0.5 + (progressPct / 100) * 1.5;
  homeScore += scoreDiff * stateWeight;
  if (Math.abs(scoreDiff) >= 2) {
    reasons.push(`${scoreDiff > 0 ? home.abbr : away.abbr} leads by ${Math.abs(scoreDiff)}`);
  }

  // Basketball / hockey efficiency comparisons.
  const cmp = (h?: number, a?: number, weight = 1, label = "") => {
    if (h == null || a == null) return;
    const diff = h - a;
    if (Math.abs(diff) < 0.5) return;
    homeScore += diff * weight;
    if (Math.abs(diff) >= (label.includes("%") ? 3 : 2)) {
      reasons.push(`${diff > 0 ? home.abbr : away.abbr} +${Math.abs(diff).toFixed(1)} ${label}`.trim());
    }
  };

  if (league.startsWith("basketball")) {
    cmp(home.fgPct, away.fgPct, 0.6, "FG%");
    cmp(home.threePct, away.threePct, 0.5, "3P%");
    cmp(home.ftPct, away.ftPct, 0.15, "FT%");
    cmp(home.pointsInPaint, away.pointsInPaint, 0.1, "PIP");
    cmp(home.fastBreakPoints, away.fastBreakPoints, 0.1, "FB");
    cmp(home.assists, away.assists, 0.08, "AST");
    cmp(home.rebounds, away.rebounds, 0.05, "REB");
    cmp(home.offReb, away.offReb, 0.1, "OREB");
    cmp(away.turnovers, home.turnovers, 0.25, "TO mgmt"); // fewer TOs = better
    cmp(home.pointsOffTurnovers, away.pointsOffTurnovers, 0.15, "PTS off TO");
  } else if (league.startsWith("hockey")) {
    cmp(home.shots, away.shots, 0.3, "shots");
    cmp(home.hits, away.hits, 0.05, "hits");
    cmp(home.faceoffPct, away.faceoffPct, 0.05, "FO%");
    cmp(home.ppPct, away.ppPct, 0.1, "PP%");
  }

  const magnitude = Math.min(100, Math.abs(homeScore) * 3.5 + 15);
  const favored = Math.abs(homeScore) < 0.5 ? null : homeScore > 0 ? home.name : away.name;
  return { favored, lean: Math.round(magnitude), reasons: reasons.slice(0, 4) };
}

export const getLiveGameStats = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      teamA: z.string().min(1).max(80),
      teamB: z.string().min(1).max(80).optional(),
      leagueHint: z.string().min(1).max(80).optional(),
    }),
  )
  .handler(async ({ data }): Promise<LiveGameStats | null> => {
    const leagues = leagueFromHint(data.leagueHint ?? data.teamA);
    for (const league of leagues) {
      const events = await fetchScoreboard(league);
      for (const ev of events) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const competitors = comp.competitors ?? [];
        const teams = competitors.map((c: any) => ({
          name: c.team?.displayName ?? "",
          abbr: c.team?.abbreviation ?? "",
          score: Number(c.score ?? 0),
          homeAway: c.homeAway as "home" | "away",
        }));
        const matchA = teams.find((t: any) => teamMatches(data.teamA, t.name, t.abbr));
        const matchB = data.teamB ? teams.find((t: any) => teamMatches(data.teamB!, t.name, t.abbr)) : matchA;
        if (!matchA || !matchB || matchA === matchB) continue;

        const home = teams.find((t: any) => t.homeAway === "home") ?? teams[0];
        const away = teams.find((t: any) => t.homeAway === "away") ?? teams[1];
        const state = (ev.status?.type?.state ?? "pre") as LiveGameStats["state"];
        const period = Number(ev.status?.period ?? 0);
        const clock = String(ev.status?.displayClock ?? "");
        const shortDetail = String(ev.status?.type?.shortDetail ?? "");
        const eventId = String(ev.id ?? "");

        const scoreDiff = home.score - away.score;
        const trailing = scoreDiff === 0 ? null : scoreDiff < 0 ? home.name : away.name;
        const progress = progressPctForLeague(league, period, clock);
        const cb = computeComeback({ league, state, period, clock, scoreDiff, totalProgressPct: progress });

        const base: LiveGameStats = {
          league,
          eventId,
          state,
          shortDetail,
          period,
          clock,
          home: { name: home.name, abbr: home.abbr, score: home.score },
          away: { name: away.name, abbr: away.abbr, score: away.score },
          trailingTeam: trailing,
          scoreDiff: Math.abs(scoreDiff),
          possession: comp.situation?.possession,
          lastPlay: comp.situation?.lastPlay?.text,
          comebackScore: cb.score,
          comebackReason: cb.reason,
        };

        // For in-progress (and just-finished) games, pull the box score and compute outcome lean.
        if (state === "in" || state === "post") {
          const summary = await fetchSummary(league, eventId);
          const sumTeams = summary?.boxscore?.teams ?? [];
          const homeRaw = sumTeams.find((t: any) => t.homeAway === "home")?.statistics ?? [];
          const awayRaw = sumTeams.find((t: any) => t.homeAway === "away")?.statistics ?? [];
          if (homeRaw.length || awayRaw.length) {
            const homeLine = buildTeamStatLine(
              { name: home.name, abbr: home.abbr, homeAway: "home", score: home.score },
              homeRaw,
            );
            const awayLine = buildTeamStatLine(
              { name: away.name, abbr: away.abbr, homeAway: "away", score: away.score },
              awayRaw,
            );
            base.teamStats = { home: homeLine, away: awayLine };
            base.outcomeLean = computeOutcomeLean(league, homeLine, awayLine, scoreDiff, progress);
          }
        }

        return base;
      }
    }
    return null;
  });
