import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Auto-capture closing odds for pending bets.
 *
 * Called by pg_cron every 15 min. For every pending bet with no closing_odds
 * (created within the last 7 days), this:
 *   1. Pulls the live H2H market for that sport from The Odds API
 *   2. Fuzzy-matches the bet's game to an event in the feed
 *   3. De-vigs DraftKings / FanDuel / Pinnacle and averages → fair prob for the picked side
 *   4. Converts fair prob → decimal odds and writes closing_odds + clv_percent
 *
 * We overwrite on every run so the *last* value before tip-off ends up stored —
 * that's the true closing line. Once the bet settles, the Ledger picks it up
 * automatically.
 *
 * Public route (no auth) but only mutates rows by id with verified market data.
 */

const SPORT_KEY: Record<string, string> = {
  NBA: "basketball_nba",
  NFL: "americanfootball_nfl",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamsMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** "Game 4: Oklahoma City at San Antonio" → { away, home } */
function parseGame(game: string): { away: string; home: string } | null {
  const cleaned = game.replace(/^Game\s+\d+\s*:\s*/i, "").trim();
  const m = cleaned.split(/\s+at\s+|\s+@\s+|\s+vs\.?\s+/i);
  if (m.length < 2) return null;
  return { away: m[0].trim(), home: m[1].trim() };
}

/** "Oklahoma City @ 50%" → "Oklahoma City" */
function parsePick(pick: string): string {
  return pick.split("@")[0].trim();
}

type OddsEvent = {
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: Array<{
    title: string;
    markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }>;
  }>;
};

async function fetchSportFeed(sportKey: string, apiKey: string): Promise<OddsEvent[] | null> {
  const url =
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
    `?apiKey=${apiKey}&regions=us&markets=h2h` +
    `&bookmakers=draftkings,fanduel,pinnacle&oddsFormat=decimal`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as OddsEvent[];
  } catch {
    return null;
  }
}

function fairProbsForEvent(ev: OddsEvent): { home: number; away: number } | null {
  const perBook: Array<{ h: number; a: number }> = [];
  for (const bm of ev.bookmakers) {
    const h2h = bm.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    const homeOut = h2h.outcomes.find((o) => teamsMatch(o.name, ev.home_team));
    const awayOut = h2h.outcomes.find((o) => teamsMatch(o.name, ev.away_team));
    if (!homeOut || !awayOut) continue;
    if (homeOut.price < 1.01 || awayOut.price < 1.01) continue;
    const ih = 1 / homeOut.price;
    const ia = 1 / awayOut.price;
    const total = ih + ia;
    perBook.push({ h: ih / total, a: ia / total });
  }
  if (!perBook.length) return null;
  return {
    home: perBook.reduce((s, b) => s + b.h, 0) / perBook.length,
    away: perBook.reduce((s, b) => s + b.a, 0) / perBook.length,
  };
}

export const Route = createFileRoute("/api/public/hooks/capture-closing-odds")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        const apiKey = process.env.ODDS_API_KEY;
        if (!apiKey) {
          return Response.json({ ok: false, error: "ODDS_API_KEY missing" }, { status: 500 });
        }

        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: bets, error } = await supabaseAdmin
          .from("bets")
          .select("id, game, sport, pick, odds, created_at")
          .eq("result", "Pending")
          .is("closing_odds", null)
          .gte("created_at", cutoff)
          .limit(500);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (!bets || !bets.length) {
          return Response.json({ ok: true, scanned: 0, updated: 0, skipped: 0 });
        }

        // Group bets by sport so we hit each sport feed only once
        const bySport = new Map<string, typeof bets>();
        for (const b of bets) {
          const s = (b.sport ?? "").toUpperCase();
          if (!SPORT_KEY[s]) continue;
          if (!bySport.has(s)) bySport.set(s, []);
          bySport.get(s)!.push(b);
        }

        const feeds = new Map<string, OddsEvent[]>();
        for (const sport of bySport.keys()) {
          const feed = await fetchSportFeed(SPORT_KEY[sport], apiKey);
          if (feed) feeds.set(sport, feed);
        }

        let updated = 0;
        let skipped = 0;
        const reasons: Record<string, number> = {};
        const bump = (k: string) => {
          reasons[k] = (reasons[k] ?? 0) + 1;
          skipped += 1;
        };

        for (const [sport, sportBets] of bySport.entries()) {
          const feed = feeds.get(sport);
          if (!feed) {
            sportBets.forEach(() => bump("feed_unavailable"));
            continue;
          }
          for (const bet of sportBets) {
            const teams = parseGame(bet.game ?? "");
            if (!teams) { bump("bad_game_format"); continue; }
            const event = feed.find(
              (e) =>
                (teamsMatch(e.home_team, teams.home) && teamsMatch(e.away_team, teams.away)) ||
                (teamsMatch(e.home_team, teams.away) && teamsMatch(e.away_team, teams.home))
            );
            if (!event) { bump("no_event_match"); continue; }

            const fair = fairProbsForEvent(event);
            if (!fair) { bump("no_book_markets"); continue; }

            const pickTeam = parsePick(bet.pick ?? "");
            if (!pickTeam) { bump("bad_pick_format"); continue; }

            let prob: number;
            if (teamsMatch(event.home_team, pickTeam)) prob = fair.home;
            else if (teamsMatch(event.away_team, pickTeam)) prob = fair.away;
            else { bump("pick_team_unmatched"); continue; }

            if (prob <= 0 || prob >= 1) { bump("invalid_prob"); continue; }

            const closingDec = 1 / prob;
            const entry = Number(bet.odds ?? 0);
            const clv =
              entry >= 1.01 ? (entry / closingDec - 1) * 100 : null;

            const { error: updErr } = await supabaseAdmin
              .from("bets")
              .update({
                closing_odds: Number(closingDec.toFixed(4)),
                closing_captured_at: new Date().toISOString(),
                clv_percent: clv !== null ? Number(clv.toFixed(2)) : null,
              })
              .eq("id", bet.id);

            if (updErr) { bump("db_update_failed"); continue; }
            updated += 1;
          }
        }

        return Response.json({
          ok: true,
          scanned: bets.length,
          updated,
          skipped,
          reasons,
          sports: Array.from(bySport.keys()),
        });
      },
    },
  },
});
