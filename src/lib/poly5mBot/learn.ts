// Situation learning for the 5m paper bot. Pure.
// A situation is traded until it has MIN_SAMPLES results; after that it is
// traded only if its smoothed win rate beats the average price paid plus fees.
export const MIN_SAMPLES = 20;
export const FEE_EST = 0.01; // ~1¢ per contract estimate

export type SitStats = { n: number; wins: number; px_sum: number; pnl_per_dollar_sum: number };

export const smoothedWinRate = (s: SitStats) => (s.wins + 1) / (s.n + 2);
export const breakEven = (s: SitStats) => (s.n > 0 ? s.px_sum / s.n : 0.5) + FEE_EST;

export function isAllowed(s: SitStats | null | undefined): boolean {
  if (!s || s.n < MIN_SAMPLES) return true;
  return smoothedWinRate(s) > breakEven(s);
}

/** Add one settled (shadow or real) result: entry at `px`, held to settle. */
export function addResult(s: SitStats, won: boolean, px: number): SitStats {
  return {
    n: s.n + 1,
    wins: s.wins + (won ? 1 : 0),
    px_sum: s.px_sum + px,
    pnl_per_dollar_sum: s.pnl_per_dollar_sum + (won ? (1 - px) / px : -1),
  };
}
