// Fast, closed-form odds for the current 15m BTC UP/DOWN market.
// Presentational-only: does NOT feed the model, Study, or auto-trade paths.
//
// Modeled after how Kalshi actually prices BTC 15m:
//   1. Underlying = composite BRTI-style spot (Coinbase+Binance median).
//   2. Fair value = driftless GBM survival prob:
//        mid = Φ( ln(S/K) / (σ · √T) )
//      with σ = short-horizon realized vol.
//   3. Quotes are shifted by a synthetic bid/ask spread + a small momentum
//      tilt, so UP¢ + DOWN¢ > 100 (house edge / MM spread) and the two
//      American odds are never equal. This mirrors Kalshi's order-book
//      structure where YES ask + NO ask always exceed 100¢.

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
 * Fallback path when the tick-tape is cold.
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
  const barsPerYear = SECONDS_PER_YEAR / 60;
  return sigmaPerBar * Math.sqrt(barsPerYear);
}

export interface TapeSample { t: number; p: number }

/**
 * EWMA realized vol from a live tick tape (annualized).
 * λ=0.94 gives a ~2min half-life on 1s samples — reactive but stable.
 * Time-weighted so uneven sample spacing (WS jitter) doesn't bias σ.
 */
export function ewmaVolFromTape(samples: TapeSample[], lambda = 0.94): number | null {
  if (!samples || samples.length < 10) return null;
  let ewvarPerSec = 0;
  let seeded = false;
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = Math.max(0.05, (b.t - a.t) / 1000); // seconds
    if (!(a.p > 0) || !(b.p > 0) || dt > 30) continue;
    const r = Math.log(b.p / a.p);
    const varPerSec = (r * r) / dt;
    if (!seeded) { ewvarPerSec = varPerSec; seeded = true; }
    else ewvarPerSec = lambda * ewvarPerSec + (1 - lambda) * varPerSec;
    count++;
  }
  if (!seeded || count < 8) return null;
  const sigmaPerSec = Math.sqrt(Math.max(ewvarPerSec, 0));
  return sigmaPerSec * Math.sqrt(SECONDS_PER_YEAR);
}

/**
 * Short-horizon momentum tilt in probability units (fraction, e.g. 0.02 = +2¢).
 * Signed by direction of last-windowMs drift, magnitude = |z| of that drift
 * vs. the tape's realized 1s stdev, clamped to ±3¢. Kalshi MMs lean their
 * quotes similarly when the tape is trending; we compute it locally so our
 * odds react faster than their book.
 */
export function momentumTilt(samples: TapeSample[], windowMs = 60_000): number {
  if (!samples || samples.length < 10) return 0;
  const now = samples[samples.length - 1].t;
  const cutoff = now - windowMs;
  let anchor: TapeSample | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].t <= cutoff) { anchor = samples[i]; break; }
    anchor = samples[i];
  }
  if (!anchor) return 0;
  const last = samples[samples.length - 1];
  if (!(anchor.p > 0) || !(last.p > 0)) return 0;
  const drift = Math.log(last.p / anchor.p);

  // Baseline 1s stdev from tape.
  const rets: number[] = [];
  for (let i = Math.max(1, samples.length - 120); i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = Math.max(0.05, (b.t - a.t) / 1000);
    if (a.p > 0 && b.p > 0 && dt < 30) rets.push(Math.log(b.p / a.p) / Math.sqrt(dt));
  }
  if (rets.length < 8) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rets.length - 1);
  const sd = Math.sqrt(Math.max(varr, 0));
  const dtWindow = Math.max(1, (last.t - anchor.t) / 1000);
  const expected = sd * Math.sqrt(dtWindow);
  if (!(expected > 0)) return 0;
  const z = drift / expected;
  const tilt = Math.max(-3, Math.min(3, z)) / 100; // ±3¢ cap → ±0.03
  return tilt;
}

/**
 * Synthetic half-spread (probability units). Wider with more time on the
 * clock (uncertainty), tighter near close. Guarantees UP¢ + DOWN¢ > 100
 * and asymmetric American odds.
 */
export function halfSpread(secondsToClose: number): number {
  const tMin = Math.max(0.1, secondsToClose / 60);
  return Math.max(0.01, 0.005 * Math.sqrt(tMin)); // 1¢..~3.5¢ across a 15m window
}

export interface UpProbInput {
  spot: number;
  strike: number;
  secondsToClose: number;
  sigmaAnnualized: number;
}

/** Legacy: raw mid P(UP) with clamps. Kept for callers that only want fair value. */
export function computeUpProbability(inp: UpProbInput): number | null {
  const { spot, strike, sigmaAnnualized } = inp;
  if (!(spot > 0) || !(strike > 0) || !(sigmaAnnualized > 0)) return null;
  const T = Math.max(inp.secondsToClose, 5) / SECONDS_PER_YEAR;
  const denom = sigmaAnnualized * Math.sqrt(T);
  if (!(denom > 0)) return null;
  const z = Math.log(spot / strike) / denom;
  const p = phi(z);
  if (!Number.isFinite(p)) return null;
  return Math.min(0.995, Math.max(0.005, p));
}

export interface QuoteInput extends UpProbInput {
  momentumTiltPct?: number; // signed fraction, e.g. +0.015 = +1.5¢ UP lean
}

export interface OurQuote {
  mid: number;         // fair-value P(UP) after tilt (0..1)
  pUpAsk: number;      // ask-side P(UP) (0..1)
  pDownAsk: number;    // ask-side P(DOWN) (0..1)
  halfSpread: number;  // in probability units
  upCents: number;     // 0..100
  downCents: number;   // 0..100
}

/**
 * Full ask-side quote for UP and DOWN, always asymmetric and always
 * summing to > 100¢. Never returns equal sides.
 */
export function computeOurQuote(inp: QuoteInput): OurQuote | null {
  const rawMid = computeUpProbability(inp);
  if (rawMid == null) return null;
  const tilt = inp.momentumTiltPct ?? 0;
  const mid = Math.min(0.99, Math.max(0.01, rawMid + tilt));
  const hs = halfSpread(inp.secondsToClose);

  let pUpAsk = Math.min(0.995, Math.max(0.005, mid + hs));
  let pDownAsk = Math.min(0.995, Math.max(0.005, (1 - mid) + hs));

  // Guarantee never-equal: nudge the smaller side down by 0.1¢ if a clamp
  // collision made them exactly equal.
  if (Math.abs(pUpAsk - pDownAsk) < 1e-4) {
    if (mid >= 0.5) pDownAsk = Math.max(0.005, pDownAsk - 0.001);
    else pUpAsk = Math.max(0.005, pUpAsk - 0.001);
  }

  return {
    mid,
    pUpAsk,
    pDownAsk,
    halfSpread: hs,
    upCents: pUpAsk * 100,
    downCents: pDownAsk * 100,
  };
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
