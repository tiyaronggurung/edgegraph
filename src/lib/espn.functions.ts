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

export interface LiveGameStats {
  league: EspnLeague;
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
          homeAway: c.homeAway,
        }));
        const matchA = teams.find((t: any) => teamMatches(data.teamA, t.name, t.abbr));
        const matchB = data.teamB ? teams.find((t: any) => teamMatches(data.teamB!, t.name, t.abbr)) : matchA;
        if (!matchA || !matchB || matchA === matchB) continue;

        const home = teams.find((t: any) => t.homeAway === "home") ?? teams[0];
        const away = teams.find((t: any) => t.homeAway === "away") ?? teams[1];
        const state = ev.status?.type?.state ?? "pre";
        const period = Number(ev.status?.period ?? 0);
        const clock = String(ev.status?.displayClock ?? "");
        const shortDetail = String(ev.status?.type?.shortDetail ?? "");

        const scoreDiff = home.score - away.score;
        const trailing = scoreDiff === 0 ? null : scoreDiff < 0 ? home.name : away.name;
        const progress = progressPctForLeague(league, period, clock);
        const cb = computeComeback({ league, state, period, clock, scoreDiff, totalProgressPct: progress });

        return {
          league,
          state: state as LiveGameStats["state"],
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
      }
    }
    return null;
  });
