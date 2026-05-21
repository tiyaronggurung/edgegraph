import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * No-vig fair line via The Odds API (https://the-odds-api.com).
 *
 * Pulls H2H moneylines from DraftKings, FanDuel, and Pinnacle, de-vigs each
 * book independently (divides implied probs by their sum), then averages the
 * three to produce a consensus fair probability for the home team.
 *
 * Why this matters: Kalshi NBA volume is thin and the last trade price can be
 * stale by minutes. Sportsbook consensus (especially with Pinnacle, the sharpest
 * book) is the closest thing to "true" probability available without paying for
 * a real data feed.
 *
 * Returns null when no matching event is found, or the upstream fails. Live
 * page degrades gracefully — the existing Kalshi/ESPN math is untouched.
 */

const SPORT_KEY: Record<string, string> = {
  "basketball/nba": "basketball_nba",
  "football/nfl": "americanfootball_nfl",
  "baseball/mlb": "baseball_mlb",
  "hockey/nhl": "icehockey_nhl",
};

const InputSchema = z.object({
  league: z.string().min(1).max(64),
  homeName: z.string().min(1).max(128),
  awayName: z.string().min(1).max(128),
});

type BookOdds = { book: string; homeDec: number; awayDec: number };
type BookFair = { book: string; homeProb: number; awayProb: number; vigPct: number };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamsMatch(apiName: string, target: string): boolean {
  const a = norm(apiName);
  const t = norm(target);
  if (!a || !t) return false;
  return a === t || a.includes(t) || t.includes(a);
}

export const getNoVigFairLine = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "ODDS_API_KEY not configured" };
    }
    const sportKey = SPORT_KEY[data.league];
    if (!sportKey) {
      return { ok: false as const, error: `League ${data.league} not supported by Odds API` };
    }

    const url =
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
      `?apiKey=${apiKey}` +
      `&regions=us` +
      `&markets=h2h` +
      `&bookmakers=draftkings,fanduel,pinnacle` +
      `&oddsFormat=decimal`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      return { ok: false as const, error: `Network error: ${(e as Error).message}` };
    }
    if (!res.ok) {
      return { ok: false as const, error: `Odds API ${res.status}` };
    }

    const events = (await res.json()) as Array<{
      id: string;
      home_team: string;
      away_team: string;
      commence_time: string;
      bookmakers: Array<{
        key: string;
        title: string;
        markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }>;
      }>;
    }>;

    const event = events.find(
      (e) =>
        (teamsMatch(e.home_team, data.homeName) && teamsMatch(e.away_team, data.awayName)) ||
        (teamsMatch(e.home_team, data.awayName) && teamsMatch(e.away_team, data.homeName))
    );
    if (!event) {
      return { ok: false as const, error: "No matching game in sportsbook feed" };
    }

    const books: BookOdds[] = [];
    for (const bm of event.bookmakers) {
      const h2h = bm.markets.find((m) => m.key === "h2h");
      if (!h2h) continue;
      const homeOut = h2h.outcomes.find((o) => teamsMatch(o.name, event.home_team));
      const awayOut = h2h.outcomes.find((o) => teamsMatch(o.name, event.away_team));
      if (!homeOut || !awayOut) continue;
      if (homeOut.price < 1.01 || awayOut.price < 1.01) continue;
      books.push({ book: bm.title, homeDec: homeOut.price, awayDec: awayOut.price });
    }

    if (!books.length) {
      return { ok: false as const, error: "No usable H2H markets returned" };
    }

    const perBook: BookFair[] = books.map((b) => {
      const ih = 1 / b.homeDec;
      const ia = 1 / b.awayDec;
      const total = ih + ia;
      return {
        book: b.book,
        homeProb: ih / total,
        awayProb: ia / total,
        vigPct: (total - 1) * 100,
      };
    });

    const avgHome = perBook.reduce((s, b) => s + b.homeProb, 0) / perBook.length;
    const avgAway = perBook.reduce((s, b) => s + b.awayProb, 0) / perBook.length;
    const avgVig = perBook.reduce((s, b) => s + b.vigPct, 0) / perBook.length;

    return {
      ok: true as const,
      fairHomeProb: avgHome,
      fairAwayProb: avgAway,
      avgVigPct: avgVig,
      books: perBook,
      matchedHome: event.home_team,
      matchedAway: event.away_team,
      commenceTime: event.commence_time,
    };
  });
