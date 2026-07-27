// Fast, closed-form odds for the current 15m BTC UP/DOWN market.
// Presentational-only: does NOT feed the model, Study, or auto-trade paths.
//
// Kalshi's BTC 15m book is quoted off a BRTI-style composite spot with:
//   - driftless GBM survival probability using realized vol,
//   - a tight bid/ask that widens with time-to-close (uncertainty),
//   - a small momentum lean that decays as T→0,
//   - a fat-tail bump so ITM sides don't sit at 99¢ too early.
//
// We mirror all four but recompute on every tick so our quote leads the book
// by a few hundred ms on fast moves.
//
//   mid = Φ( ln(S/K) / (σ_eff · √T) ) + tilt(T)
//   σ_eff = blend( σ_short_ewma, σ_medium_ewma, closes_realized )
//                 weighted toward the short leg as T→0
//   spread = base + k · √T   (tightens near close)
//   pUpAsk = clamp(mid + spread/2), pDownAsk = clamp(1-mid + spread/2)

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
 * Time-weighted EWMA realized vol from a live tick tape (annualized).
 * Custom lambda lets us build short + medium legs from the same tape.
 * Default λ=0.94 → ~2min half-life on 1s samples.
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
 * Blend a fast (30s half-life) and slow (2min half-life) EWMA leg from the
 * same tape, weighting the fast leg more as time-to-close shrinks. Mirrors
 * how Kalshi MMs react on the last minute — they trust the last few ticks
 * far more than the average.
 */
export function effectiveVol(
  tape: TapeSample[],
  closes1m: number[],
  secondsToClose: number,
): number | null {
  // λ per-sample; 1s cadence: λ=0.5^(1/halflife_s)
  const lamFast = Math.pow(0.5, 1 / 30);   // ~30s halflife
  const lamSlow = Math.pow(0.5, 1 / 120);  // ~2min halflife
  const sigFast = ewmaVolFromTape(tape, lamFast);
  const sigSlow = ewmaVolFromTape(tape, lamSlow);
  const sigBar = realizedVolFromCloses(closes1m.slice(-30));

  // Weight toward the fast leg as we approach close. wFast in [0.4, 0.85].
  const T = Math.max(5, secondsToClose);
  const frac = Math.max(0, Math.min(1, 1 - T / 900)); // 0 at open, 1 at close
  const wFast = 0.4 + 0.45 * frac;

  const legs: Array<[number, number]> = [];
  if (sigFast != null) legs.push([wFast, sigFast]);
  if (sigSlow != null) legs.push([1 - wFast, sigSlow]);
  if (legs.length === 0 && sigBar != null) return sigBar;
  if (legs.length === 0) return null;

  const wSum = legs.reduce((s, [w]) => s + w, 0);
  let blended = legs.reduce((s, [w, v]) => s + w * v, 0) / wSum;

  // Fat-tail bump: if the closes-based leg is notably higher than tape,
  // BTC just had a jump the EWMA underweights. Nudge σ up 10-20%.
  if (sigBar != null && blended > 0) {
    const ratio = sigBar / blended;
    if (ratio > 1.3) blended *= Math.min(1.2, 1 + 0.15 * (ratio - 1.3));
  }
  // Floor: 0.15 annualized (~15% vol) so we never quote a degenerate σ≈0
  // that snaps every side to 99/1 on a $2 move.
  return Math.max(blended, 0.15);
}

/**
 * Short-horizon momentum tilt in probability units (fraction). Signed by
 * direction of last-windowMs drift, magnitude = |z| of that drift vs. the
 * tape's realized 1s stdev, clamped to ±3¢. Scaled down in the last 30s
 * where 1-tick noise dominates and Kalshi MMs pull their lean.
 */
export function momentumTilt(
  samples: TapeSample[],
  windowMs = 60_000,
  secondsToClose?: number,
): number {
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
  let tilt = Math.max(-3, Math.min(3, z)) / 100; // ±3¢ cap → ±0.03

  // Kalshi-style: keep lean alive near close instead of snapping to 50/50.
  // Full lean in mid-window, ~70% at close (was 30% — that was the "reset").
  if (secondsToClose != null) {
    const tSec = Math.max(0, secondsToClose);
    let decay = 1;
    if (tSec < 30) decay = 0.7;
    else if (tSec < 90) decay = 0.7 + 0.3 * ((tSec - 30) / 60);
    tilt *= decay;
  }
  return tilt;

}

/**
 * Synthetic half-spread (probability units). Wider with more time on the
 * clock (uncertainty), tighter near close as MMs compete for the last flow.
 * Guarantees UP¢ + DOWN¢ > 100 and asymmetric American odds.
 */
export function halfSpread(secondsToClose: number): number {
  const t = Math.max(0, secondsToClose);
  // Base 0.6¢ + 0.45¢ * √minutes → ~0.6¢ at close, ~2.4¢ at open.
  const tMin = t / 60;
  const raw = 0.006 + 0.0045 * Math.sqrt(Math.max(tMin, 0.05));
  // Final 20s: MMs pull further in, quote 0.4¢ half-spread.
  if (t < 20) return Math.max(0.004, raw * 0.7);
  return raw;
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
  const T = Math.max(inp.secondsToClose, 3) / SECONDS_PER_YEAR;
  const denom = sigmaAnnualized * Math.sqrt(T);
  if (!(denom > 0)) return null;
  const z = Math.log(spot / strike) / denom;
  const p = phi(z);
  if (!Number.isFinite(p)) return null;
  return Math.min(0.995, Math.max(0.005, p));
}

export interface QuoteInput extends UpProbInput {
  momentumTiltPct?: number; // signed fraction, e.g. +0.015 = +1.5¢ UP lean
  midPivotTiltPct?: number; // legacy — no longer used as tilt; kept for shape
  midPrice?: number | null; // trendline MID (SELL+BUY)/2 — the anchor
  buyPrice?: number | null; // upper trendline pill (resistance)
  sellPrice?: number | null;// lower trendline pill (support)
}



export interface OurQuote {
  mid: number;         // fair-value P(UP) after tilt (0..1)
  pUpAsk: number;      // ask-side P(UP) (0..1)
  pDownAsk: number;    // ask-side P(DOWN) (0..1)
  halfSpread: number;  // in probability units
  upCents: number;     // 0..100
  downCents: number;   // 0..100
  timeDecayFrac: number; // 0 at open → 1 at close (for UI decay bar)
  midPivotTiltPct: number; // signed fraction actually applied
}

/**
 * Trendline MID pivot tilt (signed fraction, capped ±4¢).
 * Side = sign(spot - midPrice). Magnitude scales with |spot-MID|/spot and
 * a time-growing weight (weak at open, peaks in last ~3 min) — matches the
 * `mid_support_study` edge curve where MID predicts settlement side best
 * as T shrinks.
 */
export function midPivotTilt(
  spot: number | null | undefined,
  midPrice: number | null | undefined,
  secondsToClose: number,
): number {
  if (!(spot != null && spot > 0) || !(midPrice != null && midPrice > 0)) return 0;
  const dist = (spot - midPrice) / spot; // signed fraction of price
  // Saturate distance: 0.05% strike-distance ≈ full-strength side signal.
  const magFrac = Math.min(1, Math.abs(dist) / 0.0005);
  // Time weight: 0.15 at open (>10min), rising to 1.0 in the last 60s.
  const T = Math.max(0, secondsToClose);
  let wT: number;
  if (T >= 600)      wT = 0.15;
  else if (T >= 300) wT = 0.15 + 0.35 * ((600 - T) / 300); // → 0.50
  else if (T >= 60)  wT = 0.50 + 0.40 * ((300 - T) / 240); // → 0.90
  else               wT = 0.90 + 0.10 * ((60 - T) / 60);   // → 1.00
  const magCents = 4 * magFrac * wT;                       // ±4¢ cap
  return Math.sign(dist) * (magCents / 100);
}

/**
 * Full ask-side quote for UP and DOWN, always asymmetric and always
 * summing to > 100¢. Never returns equal sides.
 */
export function computeOurQuote(inp: QuoteInput): OurQuote | null {
  const { spot, strike, sigmaAnnualized, midPrice } = inp;
  if (!(spot > 0) || !(strike > 0) || !(sigmaAnnualized > 0)) return null;

  const T = Math.max(inp.secondsToClose, 3);
  const Tyr = T / SECONDS_PER_YEAR;
  const denom = sigmaAnnualized * Math.sqrt(Tyr);
  if (!(denom > 0)) return null;

  // Three inputs → one anchor price:
  //   strike  = target line
  //   spot    = where BTC is right now
  //   MID     = where the trendline (SELL+BUY)/2 says price is pivoting
  // anchor_price = wMid*MID + (1-wMid)*spot, wMid grows with time decay.
  // Odds = Φ( ln(anchor / strike) / (σ·√T) )
  const hasMid = midPrice != null && Number.isFinite(midPrice) && midPrice > 0;
  const t = Math.max(0, inp.secondsToClose);
  let wMid = 0;
  if (hasMid) {
    if (t >= 600)      wMid = 0.15;
    else if (t >= 300) wMid = 0.15 + 0.35 * ((600 - t) / 300);
    else if (t >= 60)  wMid = 0.50 + 0.30 * ((300 - t) / 240);
    else               wMid = 0.80 + 0.15 * ((60 - t) / 60);
  }
  const anchorPrice = hasMid
    ? wMid * (midPrice as number) + (1 - wMid) * spot
    : spot;

  const zAnchor = Math.log(anchorPrice / strike) / denom;
  const anchorMid = Math.min(0.995, Math.max(0.005, phi(zAnchor)));
  const spotMid = Math.min(0.995, Math.max(0.005, phi(Math.log(spot / strike) / denom)));


  // Momentum lean survives the blend — small but real edge over Kalshi.
  const momTilt = inp.momentumTiltPct ?? 0;
  let mid = Math.min(0.99, Math.max(0.01, anchorMid + momTilt));

  const hs = halfSpread(inp.secondsToClose);
  let pUpAsk = Math.min(0.995, Math.max(0.005, mid + hs));
  let pDownAsk = Math.min(0.995, Math.max(0.005, (1 - mid) + hs));

  if (Math.abs(pUpAsk - pDownAsk) < 1e-4) {
    if (mid >= 0.5) pDownAsk = Math.max(0.005, pDownAsk - 0.001);
    else pUpAsk = Math.max(0.005, pUpAsk - 0.001);
  }

  const timeDecayFrac = Math.max(0, Math.min(1, 1 - Math.max(0, inp.secondsToClose) / 900));
  // Report the effective pivot influence for the UI decay bar.
  const effectivePivot = hasMid ? (anchorMid - spotMid) : 0;

  return {
    mid,
    pUpAsk,
    pDownAsk,
    halfSpread: hs,
    upCents: pUpAsk * 100,
    downCents: pDownAsk * 100,
    timeDecayFrac,
    midPivotTiltPct: effectivePivot,
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
