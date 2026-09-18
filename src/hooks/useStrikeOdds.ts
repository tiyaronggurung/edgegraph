// Standalone fast odds for the current 15m BTC UP/DOWN strike.
//
// Deliberately independent of useOurQuote / ourOdds.ts — this powers the
// price card only and must never feed model, Study, auto-trade or exit paths.
//
//   pUp  = Φ( ln(S/K) / (σ · √T) )            base, pure diffusion
//   tilt = SMA20 + RSI14 + MACD(12/26/9) + avg-cost (VWAP) blend, -1..+1
//   pAdj = pUp + TILT_MAX · tilt · w(T)        technical tilt, time-decayed
//   flip = 2·Φ(-|z|)                           chance of crossing before close
//
// Time constraint: the technical tilt is strongest early in the window and
// decays to ~0 by the close (no time left for momentum to carry price), while
// the diffusion term naturally tightens as T → 0. Flip warnings are suppressed
// inside the last FLIP_MIN_SECONDS because there is no time for a real cross.
import { useEffect, useRef, useState } from "react";
import type { IndicatorSnap } from "@/lib/btcFlowLeanHistory.functions";

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const VOL_PRIOR = 0.45;        // annualized fallback before the tape warms up
const LAMBDA = 0.94;           // EWMA decay on tick returns
const TAPE_MAX = 900;
const VOL_BAR_MS = 1000;       // vol is measured on ~1s bars, not interpolated ticks
const VOL_MAX = 1.5;           // 150%/yr ceiling — above this the estimate is noise
const MIN_DT_MS = 120;         // faster tape = faster reaction
const SPREAD_BASE = 0.012;     // 1.2¢ floor
const SPREAD_K = 0.05;         // widens with √(minutes left)
const FLIP_WARN = 0.32;        // flip risk that raises the early flag
const FLIP_MIN_SECONDS = 20;   // below this there is no time to flip
const VEL_WINDOW_MS = 30_000;  // horizon for measured price velocity
const MOM_PERSIST = 0.35;      // how much of measured velocity is assumed to carry
const TILT_DRIFT_K = 0.9;      // technical tilt → drift, in σ-per-second units
const DRIFT_CAP_SIGMAS = 0.6;  // projected drift can't exceed this many σ√T
const CROSS_OVERSHOOT = 0.35;  // drift may reach the strike + this much σ√T, never further
const BRK_WINDOW_MS = 10 * 60_000; // range used for break-high / break-low read
const P_CAP_BASE = 0.88;       // ceiling when indicators do NOT confirm the side
const P_CAP_MAX = 0.97;        // ceiling only when confirmed AND time is nearly out
const SHRINK_MIN = 0.55;       // how hard we pull a fully-unconfirmed edge to 50/50
const WARM_SAMPLES = 40;       // tape size before we trust the vol estimate fully


function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const nz = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);

export interface StrikeOddsContext {
  /** Fast indicator read (1m candles). */
  m1?: IndicatorSnap | null;
  /** Slow indicator read (15m candles). */
  m15?: IndicatorSnap | null;
  /** Average taker buy / sell price over the current window (USD). */
  avgBuyPrice?: number | null;
  avgSellPrice?: number | null;
  /** Taker flow imbalance (in - out) / total, -1..1. */
  flowImbalance?: number | null;
}

export interface StrikeOddsParts {
  sma: number | null;
  rsi: number | null;
  macd: number | null;
  cost: number | null;
  flow: number | null;
  /** Where price sits in the last 10 min range: +1 = breaking highs, -1 = breaking lows. */
  brk: number | null;
}

export interface StrikeOdds {
  /** Probability the window closes above the strike, 0-1 (tilt applied). */
  pUp: number | null;
  /** Pure diffusion probability before the technical tilt. */
  pBase: number | null;
  /** UP price in 0-1; upAsk + downAsk always = 1 (100¢ total). */
  upAsk: number | null;
  downAsk: number | null;
  /** Bookmaker margin per side, 0-1 — shown for reference, not added to prices. */
  spread: number | null;
  /** Annualized realized vol used, for display. */
  sigma: number | null;
  /** Ticks in the tape — low counts mean the estimate is still warming up. */
  samples: number;
  /** Combined technical tilt, -1..+1 (positive = up). */
  tilt: number | null;
  /** Per-indicator contributions, -1..+1. */
  parts: StrikeOddsParts;
  /** How much of the tilt time still allows, 0..1. */
  timeWeight: number;
  /** Standardised distance to strike. */
  z: number | null;
  /** Probability price crosses the strike before close, 0-1 (drift-adjusted). */
  flipRisk: number | null;
  /** Side the price would flip to if it crosses. */
  flipSide: "UP" | "DOWN" | null;
  /** True when a flip looks likely early enough to matter. */
  flipFlag: boolean;
  flipReason: string | null;
  /** Combined drift, log-return per second (positive = up). */
  drift: number | null;
  /** Same drift expressed as USD per minute at the current price. */
  driftUsdPerMin: number | null;
  /** Signed USD distance to the strike (positive = strike is above spot). */
  distanceUsd: number | null;
  /** Seconds until drift alone reaches the strike, null when drifting away. */
  etaSeconds: number | null;
  /** Seconds of runway left after a projected cross; negative = won't make it. */
  leadSeconds: number | null;
  /** Uncalibrated probability straight from distance + drift. */
  pRaw: number | null;
  /** -1..+1: how much indicators, break structure and drift back the current side. */
  conviction: number | null;
  /** Ceiling applied to the winning side's probability. */
  pCap: number;
  /** Plain-language reason for the ceiling / shrink. */
  calibNote: string;
  /** Recent range used for the break read. */
  rangeHigh: number | null;
  rangeLow: number | null;
}

interface Tick { t: number; p: number }

const EMPTY_PARTS: StrikeOddsParts = { sma: null, rsi: null, macd: null, cost: null, flow: null, brk: null };

export function useStrikeOdds(
  spot: number | null,
  strike: number | null,
  secondsToClose: number,
  ctx?: StrikeOddsContext,
): StrikeOdds {
  const tapeRef = useRef<Tick[]>([]);
  const [, bump] = useState(0);

  // Keep a rolling tape of composite ticks.
  useEffect(() => {
    if (spot == null || !Number.isFinite(spot) || spot <= 0) return;
    const now = Date.now();
    const tape = tapeRef.current;
    const last = tape[tape.length - 1];
    if (last && now - last.t < MIN_DT_MS) return;
    tape.push({ t: now, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
    bump((n) => n + 1);
  }, [spot]);

  const tape = tapeRef.current;

  // Vol is measured on ~1s spaced samples, not raw ticks. The composite feed
  // interpolates between exchange updates, so sub-second returns are mostly
  // smoothing noise and blow the annualized estimate up to several hundred %.
  let sigma: number | null = null;
  const bars: Tick[] = [];
  for (const t of tape) {
    const last = bars[bars.length - 1];
    if (!last || t.t - last.t >= VOL_BAR_MS) bars.push(t);
  }
  if (bars.length >= 12) {
    let ewma: number | null = null;
    let totalDt = 0;
    let steps = 0;
    for (let i = 1; i < bars.length; i++) {
      const a = bars[i - 1] as Tick;
      const b = bars[i] as Tick;
      if (a.p <= 0 || b.p <= 0) continue;
      const r = Math.log(b.p / a.p);
      ewma = ewma == null ? r * r : LAMBDA * ewma + (1 - LAMBDA) * r * r;
      totalDt += b.t - a.t;
      steps += 1;
    }
    if (ewma != null && steps > 0 && totalDt > 0) {
      const avgDtSec = totalDt / steps / 1000;
      const perSec = Math.sqrt(Math.max(ewma, 0) / Math.max(avgDtSec, 0.05));
      const annual = perSec * Math.sqrt(SECONDS_PER_YEAR);
      if (Number.isFinite(annual) && annual > 0) sigma = clamp(annual, 0.10, VOL_MAX);
    }
  }
  const sigmaUsed = sigma ?? VOL_PRIOR;

  // --- time constraint ----------------------------------------------------
  const secs = Math.max(secondsToClose, 0);
  // Momentum needs runway: full weight early, ~0 at the bell.
  const timeWeight = clamp(Math.sqrt(secs / 900), 0, 1);
  // Fast candles matter more late in the window, slow candles early.
  const fastW = clamp(1 - secs / 900, 0.25, 0.85);

  // --- technical tilt -----------------------------------------------------
  const indTilt = (snap: IndicatorSnap | null | undefined, px: number | null) => {
    if (!snap) return EMPTY_PARTS;
    const smaDist = nz(snap.smaDistPct);
    const rsi = nz(snap.rsi);
    const hist = nz(snap.hist);
    const ref = px ?? nz(snap.close);
    return {
      // ±0.25% from the SMA saturates.
      sma: smaDist == null ? null : clamp(smaDist / 0.0025, -1, 1),
      // 50 neutral, 70/30 saturate.
      rsi: rsi == null ? null : clamp((rsi - 50) / 20, -1, 1),
      // MACD histogram as a fraction of price; 0.05% saturates.
      macd: hist == null || ref == null || ref <= 0 ? null : clamp(hist / ref / 0.0005, -1, 1),
      cost: null,
      flow: null,
      brk: null,
    } satisfies StrikeOddsParts;
  };

  const p1 = indTilt(ctx?.m1, spot);
  const p15 = indTilt(ctx?.m15, spot);
  const mix = (a: number | null, b: number | null) =>
    a == null && b == null ? null : a == null ? b : b == null ? a : fastW * a + (1 - fastW) * b;

  // Average taker cost basis: price above the blended VWAP = buyers in profit.
  const avgBuy = nz(ctx?.avgBuyPrice);
  const avgSell = nz(ctx?.avgSellPrice);
  let cost: number | null = null;
  if (spot != null && spot > 0 && (avgBuy != null || avgSell != null)) {
    const vwap = avgBuy != null && avgSell != null ? (avgBuy + avgSell) / 2 : (avgBuy ?? avgSell) as number;
    if (vwap > 0) cost = clamp((spot - vwap) / vwap / 0.0015, -1, 1);
  }
  const flow = nz(ctx?.flowImbalance) == null ? null : clamp((ctx?.flowImbalance as number) / 0.25, -1, 1);

  // --- break structure: where the running price sits in its recent range ----
  // +1 = printing new highs, -1 = new lows, 0 = mid-range chop. This is what
  // separates "price is above the strike" from "price is above the strike AND
  // still breaking out".
  let rangeHigh: number | null = null;
  let rangeLow: number | null = null;
  let brk: number | null = null;
  if (spot != null && spot > 0 && tape.length >= 10) {
    const lastT = (tape[tape.length - 1] as Tick).t;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = tape.length - 1; i >= 0; i--) {
      const t = tape[i] as Tick;
      if (lastT - t.t > BRK_WINDOW_MS) break;
      if (t.p > hi) hi = t.p;
      if (t.p < lo) lo = t.p;
    }
    if (Number.isFinite(hi) && Number.isFinite(lo) && hi > lo) {
      rangeHigh = hi;
      rangeLow = lo;
      brk = clamp(((spot - lo) / (hi - lo)) * 2 - 1, -1, 1);
    }
  }

  const parts: StrikeOddsParts = {
    sma: mix(p1.sma, p15.sma),
    rsi: mix(p1.rsi, p15.rsi),
    macd: mix(p1.macd, p15.macd),
    cost,
    flow,
    brk,
  };

  const W = { sma: 0.24, rsi: 0.14, macd: 0.22, cost: 0.12, flow: 0.10, brk: 0.18 } as const;
  let tiltNum = 0;
  let tiltDen = 0;
  (Object.keys(W) as (keyof typeof W)[]).forEach((k) => {
    const v = parts[k];
    if (v == null) return;
    tiltNum += W[k] * v;
    tiltDen += W[k];
  });
  const tilt = tiltDen > 0 ? clamp(tiltNum / tiltDen, -1, 1) : null;

  // --- measured velocity from the live tape (fastest signal available) -----
  // Log-return per second over the last VEL_WINDOW_MS of composite ticks.
  let velocity: number | null = null;
  if (tape.length >= 6) {
    const last = tape[tape.length - 1] as Tick;
    let first: Tick | null = null;
    for (let i = tape.length - 1; i >= 0; i--) {
      const t = tape[i] as Tick;
      first = t;
      if (last.t - t.t >= VEL_WINDOW_MS) break;
    }
    if (first && first.t < last.t && first.p > 0 && last.p > 0) {
      const dt = (last.t - first.t) / 1000;
      if (dt >= 3) velocity = Math.log(last.p / first.p) / dt;
    }
  }

  const sigmaSec = sigmaUsed / Math.sqrt(SECONDS_PER_YEAR);

  const emptyTail = {
    drift: null, driftUsdPerMin: null, distanceUsd: null,
    etaSeconds: null, leadSeconds: null,
    pRaw: null, conviction: null, pCap: P_CAP_BASE, calibNote: "warming up",
    rangeHigh, rangeLow,
  };

  if (spot == null || strike == null || strike <= 0 || spot <= 0) {
    return {
      pUp: null, pBase: null, upAsk: null, downAsk: null, spread: null, sigma, samples: tape.length,
      tilt, parts, timeWeight, z: null, flipRisk: null, flipSide: null,
      flipFlag: false, flipReason: null, ...emptyTail,
    };
  }

  // --- drift: measured momentum + technical/volume pressure ----------------
  // Momentum only partly persists, and the technical tilt earns drift in
  // units of σ per second so it scales with how fast the tape is moving.
  const muMeasured = velocity == null ? 0 : velocity * MOM_PERSIST;
  const muTilt = TILT_DRIFT_K * (tilt ?? 0) * sigmaSec * timeWeight;
  let drift = muMeasured * timeWeight + muTilt;
  // Never let projected drift dominate the diffusion term.
  const driftCap = secs > 0 ? (DRIFT_CAP_SIGMAS * sigmaSec * Math.sqrt(secs)) / secs : 0;
  if (driftCap > 0) drift = clamp(drift, -driftCap, driftCap);

  const tYears = Math.max(secs, 1) / SECONDS_PER_YEAR;
  const denom = sigmaUsed * Math.sqrt(tYears);
  const logDist = Math.log(spot / strike);
  const z = denom > 0 ? logDist / denom : null;
  const pBase = z == null ? null : clamp(phi(z), 0.001, 0.999);
  if (pBase == null || z == null) {
    return {
      pUp: null, pBase: null, upAsk: null, downAsk: null, spread: null, sigma, samples: tape.length,
      tilt, parts, timeWeight, z: null, flipRisk: null, flipSide: null,
      flipFlag: false, flipReason: null, ...emptyTail,
    };
  }

  // Drift-adjusted probability: technicals and flow now move the expected
  // endpoint rather than being bolted on after the fact.
  const T = Math.max(secs, 1);
  const sd = sigmaSec * Math.sqrt(T);
  // Drift may carry price to the strike plus a small overshoot — never further.
  // Momentum alone must not price the far side of the strike as the favourite.
  const maxMove = Math.abs(logDist) + CROSS_OVERSHOOT * sd;
  const driftMove = clamp(drift * T, -maxMove, maxMove);
  const zDrift = sd > 0 ? (logDist + driftMove) / sd : z;
  const pRaw = clamp(phi(zDrift), 0.01, 0.99);

  // --- upcoming-flip detection (drift-adjusted barrier touch) --------------
  const side: "UP" | "DOWN" = spot >= strike ? "UP" : "DOWN";
  const flipSide: "UP" | "DOWN" = side === "UP" ? "DOWN" : "UP";
  const b = Math.abs(logDist);                     // log distance to the strike
  const toward = side === "UP" ? -drift : drift;   // drift heading at the strike
  let flipRisk: number;
  if (b <= 0) {
    flipRisk = 1;
  } else if (sd <= 0) {
    flipRisk = 0;
  } else {
    const varT = sigmaSec * sigmaSec;
    const expArg = clamp((2 * toward * b) / Math.max(varT, 1e-18), -50, 50);
    flipRisk = clamp(
      phi((-b + toward * T) / sd) + Math.exp(expArg) * phi((-b - toward * T) / sd),
      0,
      1,
    );
  }

  const distanceUsd = strike - spot;
  const driftUsdPerMin = drift * spot * 60;
  const etaSeconds = toward > 1e-12 ? b / toward : null;
  const leadSeconds = etaSeconds == null ? null : secs - etaSeconds;

  const against = tilt == null ? 0 : side === "UP" ? Math.max(0, -tilt) : Math.max(0, tilt);
  const flipFlag =
    secs >= FLIP_MIN_SECONDS &&
    flipRisk >= FLIP_WARN &&
    toward > 0 &&
    (against >= 0.2 || (etaSeconds != null && etaSeconds <= secs));
  const etaTxt =
    etaSeconds != null && etaSeconds <= secs ? ` · ~${Math.round(etaSeconds)}s to cross` : "";
  const flipReason = !flipFlag
    ? null
    : `${(flipRisk * 100).toFixed(0)}% touch risk · $${Math.abs(distanceUsd).toFixed(0)} to go at ${driftUsdPerMin >= 0 ? "+" : ""}${driftUsdPerMin.toFixed(0)}/min${etaTxt}`;

  // --- calibration: distance alone is NOT enough ---------------------------
  // Being past the strike only earns a high price when the indicators, the
  // break structure and the measured drift all back that same side, and when
  // there is little time left for the move to unwind. Otherwise the edge is
  // pulled back toward 50/50 and hard-capped, so we never print a Kalshi-style
  // 95% just because price is a few dollars the right side of the strike.
  const sideSign = side === "UP" ? 1 : -1;
  const conv: number[] = [];
  if (tilt != null) conv.push(clamp(sideSign * tilt, -1, 1));
  if (brk != null) conv.push(clamp(sideSign * brk, -1, 1));
  conv.push(clamp((sideSign * drift) / Math.max(sigmaSec * 2, 1e-12), -1, 1));
  // Cushion in σ: a $5 cushion with 12 minutes left is not real distance.
  const cushionSigmas = sd > 0 ? clamp(b / sd, 0, 2) / 2 : 0;
  conv.push(cushionSigmas);
  const conviction = clamp(conv.reduce((a, v) => a + v, 0) / conv.length, -1, 1);

  const agree = clamp(conviction, 0, 1);           // only positive backing lifts the cap
  const timeDone = 1 - timeWeight;                 // 0 at open, 1 at the bell
  const pCap = P_CAP_BASE + (P_CAP_MAX - P_CAP_BASE) * agree * timeDone;
  let k = SHRINK_MIN + (1 - SHRINK_MIN) * ((conviction + 1) / 2);
  if (tape.length < WARM_SAMPLES) k *= 0.85;       // cold tape = less trust in σ
  const pCal = 0.5 + (pRaw - 0.5) * k;
  const pUp = clamp(pCal, 1 - pCap, pCap);
  const calibNote =
    `conviction ${conviction >= 0 ? "+" : ""}${(conviction * 100).toFixed(0)}% · ` +
    `cap ${(pCap * 100).toFixed(0)}% · raw ${(pRaw * 100).toFixed(0)}%`;

  const spread = SPREAD_BASE + SPREAD_K * Math.sqrt(secs / 900);
  return {
    pUp,
    pRaw,
    conviction,
    pCap,
    calibNote,
    rangeHigh,
    rangeLow,
    pBase,
    // Prices sum to exactly 1 (100¢ total); the margin is reported separately.
    upAsk: pUp,
    downAsk: 1 - pUp,
    spread,
    sigma,
    samples: tape.length,
    tilt,
    parts,
    timeWeight,
    z,
    flipRisk,
    flipSide,
    flipFlag,
    flipReason,
    drift,
    driftUsdPerMin,
    distanceUsd,
    etaSeconds,
    leadSeconds,
  };
}
