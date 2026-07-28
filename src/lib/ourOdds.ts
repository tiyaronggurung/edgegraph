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
  pillGateTiltPct: number; // signed fraction from strike-vs-pills gate
  recommendation: BetRecommendation; // UI-facing UP/DOWN/WAIT call w/ reason
}

export interface BetRecommendation {
  side: "UP" | "DOWN" | "WAIT";
  strength: "strong" | "lean" | "wait";
  confidencePct: number; // 0..100 = chosen-side prob (WAIT → mid or 50)
  reason: string;        // one-liner shown in the UI tooltip/pill
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
 * Calibration stretch — corrects the observed under-confidence bias.
 *
 * Study on 27k+ settled snapshots (14d, T=60–300s) shows our raw mid is
 * systematically pulled toward 0.5:
 *   pred 0.55 → actual 0.69   pred 0.65 → actual 0.78   pred 0.75 → actual 0.84
 * Fit: actual ≈ Φ( k · Φ⁻¹(pred) ) with k ≈ 1.35 corrects most of the gap
 * without over-fitting the extremes (already well-calibrated).
 * Time-scaled: only apply when T ≤ 600s (calibration is only measured there).
 */
function calibrationStretch(mid: number, secondsToClose: number): number {
  if (!(mid > 0) || !(mid < 1)) return mid;
  const T = Math.max(0, secondsToClose);
  if (T > 600) return mid;
  // k ramps from 1.0 (at 600s) up to 1.35 (at ≤120s)
  const k = T >= 600 ? 1.0
          : T >= 120 ? 1.0 + 0.35 * ((600 - T) / 480)
          : 1.35;
  if (k <= 1.0001) return mid;
  // Invert phi via Newton on Φ; cheap since we only need ~4 iterations.
  // z = Φ⁻¹(mid). Bracket-search is fine for one-shot per tick.
  let lo = -6, hi = 6, z = 0;
  for (let i = 0; i < 24; i++) {
    z = (lo + hi) / 2;
    if (phi(z) < mid) lo = z; else hi = z;
  }
  const stretched = phi(k * z);
  return Math.min(0.995, Math.max(0.005, stretched));
}

/**
 * Full ask-side quote for UP and DOWN.
 *
 * Rewritten anchor policy (Nov 2026 study):
 *   Anchor = pure (spot, strike, σ, T) physics — always. Never blended with MID.
 *   MID / BUY / SELL enter as SIGNED TILTS on top of physics:
 *     - midPivotTilt   : which side of the trendline pivot spot sits on
 *     - pillGateTilt   : structural gate when strike sits beyond both pills
 *     - pillBreakoutTilt: spot punching through a pill (support/resistance)
 *     - momentumTilt   : short-horizon drift, decays near close
 *   Final mid then passes through a calibration stretch to correct the
 *   observed under-confidence bias in the T ≤ 10min window.
 *
 * This preserves what MID/BUY/SELL contribute (structure, pivot, breakout)
 * while making STRIKE the anchor — so a $20 move above strike shows the
 * right physics-driven odds instead of being masked by a mid-pull-to-center.
 */
export function computeOurQuote(inp: QuoteInput): OurQuote | null {
  const { spot, strike, sigmaAnnualized, midPrice } = inp;
  if (!(spot > 0) || !(strike > 0) || !(sigmaAnnualized > 0)) return null;

  const T = Math.max(inp.secondsToClose, 3);
  const Tyr = T / SECONDS_PER_YEAR;
  const denom = sigmaAnnualized * Math.sqrt(Tyr);
  if (!(denom > 0)) return null;

  // === Physics anchor: spot vs strike only ===
  const spotMid = Math.min(0.995, Math.max(0.005, phi(Math.log(spot / strike) / denom)));

  // === Tilts (all signed, in probability units) ===
  const momTilt = inp.momentumTiltPct ?? 0;
  const pillTilt = pillGateTilt({
    spot,
    strike,
    midPrice: midPrice ?? null,
    buyPrice: inp.buyPrice ?? null,
    sellPrice: inp.sellPrice ?? null,
    secondsToClose: inp.secondsToClose,
  });
  const brkTilt = pillBreakoutTilt({
    spot,
    buyPrice: inp.buyPrice ?? null,
    sellPrice: inp.sellPrice ?? null,
    midPrice: midPrice ?? null,
    secondsToClose: inp.secondsToClose,
  });
  // MID pivot: which side of (SELL+BUY)/2 is spot on. Signed, ±4¢, time-weighted.
  const midTilt = midPivotTilt(spot, midPrice ?? null, inp.secondsToClose);

  // Combined pill influence for the UI decay bar (kept for backwards shape).
  const effectivePivot = midTilt + pillTilt + brkTilt;

  // Sum tilts on top of physics, then calibration-stretch.
  const rawMid = Math.min(0.99, Math.max(0.01,
    spotMid + midTilt + pillTilt + brkTilt + momTilt,
  ));
  const mid = calibrationStretch(rawMid, inp.secondsToClose);

  const hs = halfSpread(inp.secondsToClose);
  let pUpAsk = Math.min(0.995, Math.max(0.005, mid + hs));
  let pDownAsk = Math.min(0.995, Math.max(0.005, (1 - mid) + hs));
  if (Math.abs(pUpAsk - pDownAsk) < 1e-4) {
    if (mid >= 0.5) pDownAsk = Math.max(0.005, pDownAsk - 0.001);
    else pUpAsk = Math.max(0.005, pUpAsk - 0.001);
  }

  const timeDecayFrac = Math.max(0, Math.min(1, 1 - Math.max(0, inp.secondsToClose) / 900));

  const recommendation = buildRecommendation({
    mid,
    pillTilt: pillTilt + midTilt + brkTilt,
    momTilt,
    secondsToClose: inp.secondsToClose,
    spot,
    strike,
    midPrice: midPrice ?? null,
    buyPrice: inp.buyPrice ?? null,
    sellPrice: inp.sellPrice ?? null,
  });

  return {
    mid,
    pUpAsk,
    pDownAsk,
    halfSpread: hs,
    upCents: pUpAsk * 100,
    downCents: pDownAsk * 100,
    timeDecayFrac,
    midPivotTiltPct: effectivePivot,
    pillGateTiltPct: pillTilt,
    recommendation,
  };
}

/**
 * Pill-gate + MID-distance tilt (signed fraction, capped ±10¢).
 *
 * Two composable signals, both from the 30d shadow study on 2,777 settled
 * snapshots. Asymmetric — DOWN edge fires earlier and wider than UP:
 *
 *   DOWN (strike above MID, bps > 0):
 *     bps 5-10  · T<120s → ~97-100% NO      → -10¢
 *     bps 10-25 · T<120s → ~92% NO          → -10¢
 *     bps ≥25   · T<300s → ~85-92% NO       → -8¢
 *     bps 5-25  · T 120-300s → ~65-70% NO   → -5¢
 *     bps ≥25   · T 300-600s → ~55-60% NO   → -3¢
 *
 *   UP (strike below MID, bps < 0) — weaker, tighter:
 *     bps ≤-25  · T<120s → ~72% YES         → +6¢
 *     bps ≤-25  · T 120-300s → ~66% YES     → +4¢
 *     everything else → 0 (>10m reversal trap)
 *
 * The historical pill-position rule (strike ≥ $5 beyond BOTH pills) is kept
 * as an amplifier on top of the MID-distance tilt when both fire same-side.
 */
export function pillGateTilt(args: {
  spot: number | null | undefined;
  strike: number | null | undefined;
  midPrice: number | null | undefined;
  buyPrice: number | null | undefined;
  sellPrice: number | null | undefined;
  secondsToClose: number;
}): number {
  const { strike, midPrice, buyPrice, sellPrice, secondsToClose } = args;
  if (!(strike != null && strike > 0)) return 0;
  if (!(midPrice != null && midPrice > 0)) return 0;
  const T = Math.max(0, secondsToClose);
  if (T > 600) return 0;

  const distBps = ((strike - midPrice) / strike) * 10000; // signed

  // --- MID-distance lookup ---
  let midTilt = 0;
  if (distBps >= 5) {
    // strike above MID → DOWN lean
    if (T < 120) {
      if (distBps < 25) midTilt = -0.10;
      else               midTilt = -0.10;
    } else if (T < 300) {
      if (distBps < 25) midTilt = -0.05;
      else               midTilt = -0.08;
    } else {
      midTilt = distBps >= 25 ? -0.03 : 0;
    }
  } else if (distBps <= -25) {
    // strike below MID (≥25bps) → UP lean, only close to close
    if (T < 120)      midTilt = +0.06;
    else if (T < 300) midTilt = +0.04;
  }

  // --- Pill-position amplifier (legacy rule: strike ≥ $5 beyond BOTH pills) ---
  const MIN_GAP = 5;
  let pillAmp = 0;
  if (T <= 300) {
    if (buyPrice != null && buyPrice > 0
        && strike >= buyPrice + MIN_GAP
        && strike >= midPrice + MIN_GAP) {
      pillAmp = -0.02;
    } else if (sellPrice != null && sellPrice > 0
        && strike <= sellPrice - MIN_GAP
        && strike <= midPrice - MIN_GAP) {
      pillAmp = +0.02;
    }
  }

  // Only amplify when both signals agree in sign.
  const combined = (Math.sign(midTilt) === Math.sign(pillAmp)) ? midTilt + pillAmp : midTilt;
  return Math.max(-0.10, Math.min(0.10, combined));
}

/**
 * Pill-breakout tilt (signed fraction, capped ±6¢).
 *
 * Spot penetrating the BUY (upper trendline) pill or SELL (lower trendline)
 * pill is a directional trigger — Kalshi's spot-only BRTI model can't see
 * this because it has no trendline pills. Sizing:
 *
 *   spot ≥ BUY + $3   → UP breakout   → +3..+6¢ (grows with time-left decay)
 *   spot ≤ SELL - $3  → DOWN breakout → -3..-6¢
 *   spot inside pills → 0
 *
 * Tilt strengthens as T shrinks (breakouts near close rarely reverse).
 * Deactivated in the first 2 minutes (warmup — pills are still forming).
 */
export function pillBreakoutTilt(args: {
  spot: number | null | undefined;
  buyPrice: number | null | undefined;
  sellPrice: number | null | undefined;
  midPrice: number | null | undefined;
  secondsToClose: number;
}): number {
  const { spot, buyPrice, sellPrice, secondsToClose } = args;
  if (!(spot != null && spot > 0)) return 0;
  const T = Math.max(0, secondsToClose);
  if (T > 780) return 0; // first ~2min: warmup

  // Time-weight: 0.5 far from close, 1.0 at close.
  const wT = T >= 600 ? 0.5
           : T >= 300 ? 0.5 + 0.3 * ((600 - T) / 300)   // → 0.80
           : T >= 60  ? 0.80 + 0.15 * ((300 - T) / 240) // → 0.95
           : 0.95 + 0.05 * ((60 - T) / 60);             // → 1.00

  const MIN_BREAK = 3; // $
  if (buyPrice != null && buyPrice > 0 && spot >= buyPrice + MIN_BREAK) {
    const excess = Math.min(20, spot - buyPrice); // $3..$20 → 3..6¢
    const cents = 3 + 3 * ((excess - MIN_BREAK) / (20 - MIN_BREAK));
    return Math.min(0.06, (cents / 100) * wT);
  }
  if (sellPrice != null && sellPrice > 0 && spot <= sellPrice - MIN_BREAK) {
    const excess = Math.min(20, sellPrice - spot);
    const cents = 3 + 3 * ((excess - MIN_BREAK) / (20 - MIN_BREAK));
    return -Math.min(0.06, (cents / 100) * wT);
  }
  return 0;
}

/**
 * Turn the final MID + tilt state into a user-facing UP/DOWN recommendation.
 * Strong  → mid ≥ 0.66 (or ≤ 0.34) AND meaningful pill-gate/momentum tilt
 * Lean    → mid ≥ 0.58 (or ≤ 0.42)
 * WAIT    → otherwise (coin-flip zone)
 */
export function buildRecommendation(args: {
  mid: number;
  pillTilt: number;
  momTilt: number;
  secondsToClose: number;
  spot: number;
  strike: number;
  midPrice: number | null;
  buyPrice: number | null;
  sellPrice: number | null;
}): BetRecommendation {
  const { mid, pillTilt, momTilt, secondsToClose, spot, strike, midPrice } = args;
  const upProbPct = mid * 100;
  const downProbPct = (1 - mid) * 100;
  const tiltCents = (pillTilt + momTilt) * 100;
  const distBps = midPrice != null && midPrice > 0
    ? ((strike - midPrice) / strike) * 10000
    : null;

  const spotSide = spot >= strike ? "above" : "below";
  const spotDollars = Math.abs(spot - strike);

  // WAIT: coin-flip zone or no clear structure
  if (mid > 0.42 && mid < 0.58) {
    return {
      side: "WAIT",
      strength: "wait",
      confidencePct: Math.max(upProbPct, downProbPct),
      reason: `coin-flip · P(UP)=${upProbPct.toFixed(0)}% · spot $${spotDollars.toFixed(0)} ${spotSide} strike · ${secondsToClose}s left`,
    };
  }

  const side: "UP" | "DOWN" = mid >= 0.5 ? "UP" : "DOWN";
  const conf = side === "UP" ? upProbPct : downProbPct;
  const strong = conf >= 66 && Math.abs(tiltCents) >= 3;

  const parts: string[] = [`P(${side})=${conf.toFixed(0)}%`];
  if (distBps != null && Math.abs(distBps) >= 5) {
    parts.push(`strike ${distBps > 0 ? "+" : ""}${distBps.toFixed(0)}bps vs MID`);
  }
  if (Math.abs(tiltCents) >= 2) {
    parts.push(`pill-tilt ${tiltCents >= 0 ? "+" : ""}${tiltCents.toFixed(1)}¢`);
  }
  parts.push(`spot $${spotDollars.toFixed(0)} ${spotSide} strike`);
  parts.push(`${secondsToClose}s left`);

  return {
    side,
    strength: strong ? "strong" : "lean",
    confidencePct: conf,
    reason: parts.join(" · "),
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
