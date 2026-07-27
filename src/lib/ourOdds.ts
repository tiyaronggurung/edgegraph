// Fast, closed-form odds for the current 15m BTC UP/DOWN market.
// Presentational-only: does NOT feed the model, Study, or auto-trade paths.
//
// Model: driftless GBM over the remaining window.
//   ln(S_T / S) ~ Normal(0, sigma^2 * T)
//   P(S_T >= K) = Phi( ln(S/K) / (sigma * sqrt(T)) )
// sigma comes from realized 1m log-returns of the last ~30 minutes.

const SECONDS_PER_YEAR = 365 * 24 * 3600;

// Abramowitz & Stegun 7.1.26 — cheap Φ.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function phi(x: number): number { return 0.5 * (1 + erf(x / Math.SQRT2)); }

/**
 * Realized volatility (annualized) from a series of 1m closes.
 * Uses simple stdev of log-returns. Returns null if we don't have enough bars.
 */
export function realizedVolFromCloses(closes: number[]): number | null {
  if (!closes || closes.length < 5) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 4) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rets.length - 1);
  const sigmaPerBar = Math.sqrt(Math.max(varr, 0));
  // bar = 1 minute → annualize
  const barsPerYear = SECONDS_PER_YEAR / 60;
  return sigmaPerBar * Math.sqrt(barsPerYear);
}

export interface UpProbInput {
  spot: number;
  strike: number;
  secondsToClose: number;
  sigmaAnnualized: number; // e.g. 0.6 = 60% ann. vol
}

/** P(spot at close >= strike). Robust to tiny T / bad inputs → returns null. */
export function computeUpProbability(inp: UpProbInput): number | null {
  const { spot, strike, sigmaAnnualized } = inp;
  if (!(spot > 0) || !(strike > 0) || !(sigmaAnnualized > 0)) return null;
  const T = Math.max(inp.secondsToClose, 5) / SECONDS_PER_YEAR;
  const denom = sigmaAnnualized * Math.sqrt(T);
  if (!(denom > 0)) return null;
  const z = Math.log(spot / strike) / denom;
  const p = phi(z);
  if (!Number.isFinite(p)) return null;
  // Clamp so display never shows a hard 0% / 100% (which would imply infinite odds).
  return Math.min(0.995, Math.max(0.005, p));
}

/** American odds string for a probability. "-184" / "+142". */
export function toAmericanOdds(prob: number): string {
  if (!(prob > 0) || !(prob < 1)) return "—";
  if (prob >= 0.5) {
    const v = Math.round((100 * prob) / (1 - prob));
    return `-${v}`;
  }
  const v = Math.round((100 * (1 - prob)) / prob);
  return `+${v}`;
}
