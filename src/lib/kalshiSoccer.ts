// Pure client-safe helpers to detect & de-vig a 3-way soccer market
// (Team A win / Draw / Team B win) from a Kalshi event's markets.
//
// No network calls — operates on the KalshiEventLite payload already
// fetched by getKalshiSportsEvents. Safe to call in render.

import type { KalshiEventLite, KalshiMarketLite } from "@/lib/kalshi.functions";

const SOCCER_COMPETITION_RE = /soccer|mls|epl|ucl|liga|bundes|serie|super lig|world cup/i;

export function isSoccerEvent(e: KalshiEventLite): boolean {
  return SOCCER_COMPETITION_RE.test(`${e.competition} ${e.seriesTicker} ${e.title}`);
}

const DRAW_RE = /\b(draw|tie|deadlock|stalemate)\b/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse "Team A vs Team B" / "Team A at Team B" / "Team A @ Team B" from
 * the event title or sub_title. Falls back to splitting on " - ".
 */
export function parseSoccerTeams(e: KalshiEventLite): { a: string; b: string } | null {
  const src = `${e.title} ${e.subTitle}`.trim();
  const m =
    src.match(/(.+?)\s+(?:vs\.?|v\.?|at|@|-)\s+(.+?)(?:\s+\d.*)?$/i) ??
    e.title.match(/(.+?)\s+(?:vs\.?|v\.?|at|@|-)\s+(.+?)$/i);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

export interface Soccer3Way {
  teamA: string;
  teamB: string;
  marketA: KalshiMarketLite;
  marketDraw: KalshiMarketLite;
  marketB: KalshiMarketLite;
  /** De-vigged fair probabilities, sum to 1. */
  fair: { a: number; draw: number; b: number };
  /** Implied probabilities straight from yesPrice, before de-vig (may not sum to 1). */
  raw: { a: number; draw: number; b: number };
}

/**
 * Group an event's markets into A-win / Draw / B-win and de-vig.
 * Returns null when any of the three sides can't be identified.
 */
export function detectSoccer3Way(e: KalshiEventLite): Soccer3Way | null {
  if (!isSoccerEvent(e) || e.markets.length < 3) return null;
  const teams = parseSoccerTeams(e);
  if (!teams) return null;

  const na = norm(teams.a);
  const nb = norm(teams.b);

  let marketDraw: KalshiMarketLite | null = null;
  let marketA: KalshiMarketLite | null = null;
  let marketB: KalshiMarketLite | null = null;

  for (const m of e.markets) {
    const label = m.yesSubTitle || "";
    if (!marketDraw && DRAW_RE.test(label)) {
      marketDraw = m;
      continue;
    }
    const nm = norm(label);
    if (!nm) continue;
    if (!marketA && (nm.includes(na) || na.includes(nm))) {
      marketA = m;
      continue;
    }
    if (!marketB && (nm.includes(nb) || nb.includes(nm))) {
      marketB = m;
      continue;
    }
  }

  if (!marketA || !marketB || !marketDraw) return null;

  const ra = Math.max(0.01, Math.min(0.99, marketA.yesPrice));
  const rd = Math.max(0.01, Math.min(0.99, marketDraw.yesPrice));
  const rb = Math.max(0.01, Math.min(0.99, marketB.yesPrice));
  const sum = ra + rd + rb || 1;

  return {
    teamA: teams.a,
    teamB: teams.b,
    marketA,
    marketDraw,
    marketB,
    raw: { a: ra, draw: rd, b: rb },
    fair: { a: ra / sum, draw: rd / sum, b: rb / sum },
  };
}
