// Market-implied model. Converts Kalshi-style cents-prices (0..100) into devigged
// fair probabilities, so the ensemble can include "what the market thinks".
//
// Devig method: proportional / multiplicative — sum the raw implieds and rescale to 1.
// This is the industry-standard fast devig for 2- and 3-way markets.

export interface MarketLeg {
  market: string; // "1X2" | "BTTS" | "GOALS" | ...
  pick: string;
  line?: number | null;
  // Raw market percent (0..100). For Kalshi YES contracts, that's the YES last price.
  marketPct: number;
}

export interface ImpliedLeg extends MarketLeg {
  impliedProb: number; // 0..1, devigged
}

/**
 * Devig a list of legs that together cover all outcomes of a single market.
 * E.g. 1X2 legs (HOME, DRAW, AWAY) or BTTS legs (YES, NO).
 */
export function devig(legs: MarketLeg[]): ImpliedLeg[] {
  if (!legs.length) return [];
  const raw = legs.map((l) => Math.max(0, l.marketPct) / 100);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return legs.map((l) => ({ ...l, impliedProb: 0 }));
  return legs.map((l, i) => ({
    ...l,
    impliedProb: raw[i] / sum,
  }));
}

/**
 * Group legs by market+line and devig each group independently.
 */
export function devigByMarket(legs: MarketLeg[]): Map<string, ImpliedLeg[]> {
  const groups = new Map<string, MarketLeg[]>();
  for (const l of legs) {
    const key = `${l.market}|${l.line ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  const out = new Map<string, ImpliedLeg[]>();
  for (const [key, group] of groups) out.set(key, devig(group));
  return out;
}
