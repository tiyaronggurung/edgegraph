// Standalone fast odds for the current 15m BTC UP/DOWN strike.
//
// Deliberately independent of useOurQuote / ourOdds.ts — this powers the
// price card only and must never feed model, Study, auto-trade or exit paths.
//
//   pUp = Φ( ln(S/K) / (σ · √T) )
//   σ   = EWMA realized vol from the live composite tick tape
//         (falls back to a 45%/yr prior until the tape warms up)
//   ask = p + spread/2, spread widens with time to close
//
// It recomputes on every composite tick (~50-200ms), so it moves ahead of a
// book that re-quotes on a slower cadence.
import { useEffect, useRef, useState } from "react";

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const VOL_PRIOR = 0.45;        // annualized fallback before the tape warms up
const LAMBDA = 0.94;           // EWMA decay on tick returns
const TAPE_MAX = 600;
const MIN_DT_MS = 250;
const SPREAD_BASE = 0.012;     // 1.2¢ floor
const SPREAD_K = 0.05;         // widens with √(minutes left)

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

export interface StrikeOdds {
  /** Probability the window closes above the strike, 0-1. */
  pUp: number | null;
  upAsk: number | null;
  downAsk: number | null;
  /** Annualized realized vol used, for display. */
  sigma: number | null;
  /** Ticks in the tape — low counts mean the estimate is still warming up. */
  samples: number;
}

interface Tick { t: number; p: number }

export function useStrikeOdds(
  spot: number | null,
  strike: number | null,
  secondsToClose: number,
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

  let sigma: number | null = null;
  if (tape.length >= 12) {
    let ewma: number | null = null;
    let totalDt = 0;
    let steps = 0;
    for (let i = 1; i < tape.length; i++) {
      const a = tape[i - 1] as Tick;
      const b = tape[i] as Tick;
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
      if (Number.isFinite(annual) && annual > 0) sigma = clamp(annual, 0.05, 4);
    }
  }
  const sigmaUsed = sigma ?? VOL_PRIOR;

  if (spot == null || strike == null || strike <= 0 || spot <= 0) {
    return { pUp: null, upAsk: null, downAsk: null, sigma, samples: tape.length };
  }

  const tYears = Math.max(secondsToClose, 1) / SECONDS_PER_YEAR;
  const denom = sigmaUsed * Math.sqrt(tYears);
  const pUp = denom > 0 ? clamp(phi(Math.log(spot / strike) / denom), 0.001, 0.999) : null;
  if (pUp == null) return { pUp: null, upAsk: null, downAsk: null, sigma, samples: tape.length };

  const spread = SPREAD_BASE + SPREAD_K * Math.sqrt(Math.max(secondsToClose, 0) / 900);
  return {
    pUp,
    upAsk: clamp(pUp + spread / 2, 0.01, 0.99),
    downAsk: clamp(1 - pUp + spread / 2, 0.01, 0.99),
    sigma,
    samples: tape.length,
  };
}
