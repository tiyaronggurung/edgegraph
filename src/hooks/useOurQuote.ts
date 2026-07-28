import { useEffect, useMemo, useRef } from "react";
import {
  buildRecommendation,
  computeOurQuote,
  effectiveVol,
  momentumTilt,
  pillGateTilt,
  type TapeSample,
  type OurQuote,
} from "@/lib/ourOdds";


const TAPE_MAX = 900;         // ~5 min of ticks at ~300ms cadence
const TAPE_MIN_DT_MS = 250;

// Ratchet policy:
//   Within a single 15m window, once mid has moved away from 0.5 toward a side,
//   it is not allowed to give back more than GIVEBACK_FRAC of that gain unless
//   spot actually crosses the strike (a real reversal).
//   This kills the "odds reset to 50/50 every ~5min" behavior driven by
//   vol expansion / momentum decay / MID pivot mean-reversion.
const GIVEBACK_FRAC = 0.20;   // may only give back 20% of best excursion
// Persistent trendline-bias accumulator (per window), driven by pill-gate +
// momentum tilt each tick. Never resets inside a window; only decays very
// slowly (half-life ~12 min) so the trendline scope keeps mattering.
const BIAS_DECAY_PER_S = Math.pow(0.5, 1 / 720);
const BIAS_STEP = 0.0025;     // per-tick contribution when both signals agree
const BIAS_MAX = 0.08;        // ±8¢ cap

interface WindowState {
  strike: number;
  maxMid: number;              // best (highest) mid seen this window
  minMid: number;              // best (lowest) mid seen this window
  lastSpotSide: 1 | -1 | 0;    // sign(spot - strike) at last tick
  bias: number;                // persistent trendline bias (prob units)
  lastTs: number;
}

export function useOurQuote(params: {
  spot: number | null | undefined;
  strike: number | null | undefined;
  secondsToClose: number | null | undefined;
  closes1m: number[];
  midPrice?: number | null | undefined;
  buyPrice?: number | null | undefined;
  sellPrice?: number | null | undefined;
}) {
  const { spot, strike, secondsToClose, closes1m, midPrice, buyPrice, sellPrice } = params;

  const tapeRef = useRef<TapeSample[]>([]);
  const lastGoodRef = useRef<OurQuote | null>(null);
  const winRef = useRef<WindowState | null>(null);

  // Reset per-window ratchet + bias on new window (strike change).
  useEffect(() => {
    if (strike != null && (winRef.current == null || winRef.current.strike !== strike)) {
      winRef.current = {
        strike,
        maxMid: 0.5,
        minMid: 0.5,
        lastSpotSide: 0,
        bias: 0,
        lastTs: Date.now(),
      };
      lastGoodRef.current = null;
      // keep tape — vol estimation benefits from continuity across windows
    }
  }, [strike]);

  useEffect(() => {
    if (spot == null || !Number.isFinite(spot) || !(spot > 0)) return;
    const now = Date.now();
    const tape = tapeRef.current;
    const last = tape[tape.length - 1];
    if (last && now - last.t < TAPE_MIN_DT_MS) return;
    tape.push({ t: now, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
  }, [spot]);

  return useMemo(() => {
    if (spot == null || strike == null || secondsToClose == null) {
      return lastGoodRef.current;
    }
    const tape = tapeRef.current;
    const sigma = effectiveVol(tape, closes1m, secondsToClose);
    if (sigma == null) return lastGoodRef.current;
    const tilt = momentumTilt(tape, 60_000, secondsToClose);

    // Update / build window state.
    let win = winRef.current;
    if (win == null || win.strike !== strike) {
      win = {
        strike,
        maxMid: 0.5,
        minMid: 0.5,
        lastSpotSide: 0,
        bias: 0,
        lastTs: Date.now(),
      };
      winRef.current = win;
    }

    // Persistent trendline bias: accumulate signed pill-gate + momentum every
    // tick, decay very slowly. This is the "trendline scope keeps mattering"
    // piece — once trendlines lean a side hard, odds keep remembering it even
    // if instantaneous σ blows out.
    const now = Date.now();
    const dtSec = Math.max(0, (now - win.lastTs) / 1000);
    win.lastTs = now;
    const decay = Math.pow(BIAS_DECAY_PER_S, dtSec);
    win.bias *= decay;
    const pTiltNow = pillGateTilt({
      spot,
      strike,
      midPrice: midPrice ?? null,
      buyPrice: buyPrice ?? null,
      sellPrice: sellPrice ?? null,
      secondsToClose,
    });
    const agreeSign = Math.sign(pTiltNow) === Math.sign(tilt) && pTiltNow !== 0
      ? Math.sign(pTiltNow)
      : (Math.abs(pTiltNow) > Math.abs(tilt) ? Math.sign(pTiltNow) : Math.sign(tilt));
    if (agreeSign !== 0) {
      win.bias = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, win.bias + agreeSign * BIAS_STEP));
    }

    // Compose base momentum with persistent bias so downstream tilt survives.
    const compositeTilt = Math.max(-0.10, Math.min(0.10, tilt + win.bias));

    const q = computeOurQuote({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
      momentumTiltPct: compositeTilt,
      midPrice: midPrice ?? null,
      buyPrice: buyPrice ?? null,
      sellPrice: sellPrice ?? null,
    });

    if (!q) return lastGoodRef.current;

    // ---- Ratchet: never reset to 50/50 unless spot actually crosses strike ----
    const spotSide: 1 | -1 | 0 = spot > strike ? 1 : spot < strike ? -1 : 0;
    const crossed = spotSide !== 0 && win.lastSpotSide !== 0 && spotSide !== win.lastSpotSide;
    if (crossed) {
      // Real reversal: release the extreme on the opposite side so odds can flip.
      if (spotSide > 0) win.minMid = 0.5;
      else win.maxMid = 0.5;
    }
    if (spotSide !== 0) win.lastSpotSide = spotSide;

    // Register new extremes.
    if (q.mid > win.maxMid) win.maxMid = q.mid;
    if (q.mid < win.minMid) win.minMid = q.mid;

    // Floor / ceiling from ratchet: allow at most GIVEBACK_FRAC retrace toward 0.5.
    const upFloor = 0.5 + (win.maxMid - 0.5) * (1 - GIVEBACK_FRAC);
    const dnCeil  = 0.5 - (0.5 - win.minMid) * (1 - GIVEBACK_FRAC);

    let ratchetedMid = q.mid;
    // If the dominant excursion has been to the UP side, prevent collapse below upFloor.
    if (win.maxMid - 0.5 >= 0.5 - win.minMid) {
      ratchetedMid = Math.max(ratchetedMid, upFloor);
    }
    // If the dominant excursion has been to the DOWN side, prevent rise above dnCeil.
    if (0.5 - win.minMid > win.maxMid - 0.5) {
      ratchetedMid = Math.min(ratchetedMid, dnCeil);
    }
    ratchetedMid = Math.min(0.99, Math.max(0.01, ratchetedMid));

    // Re-emit quote with ratcheted mid so both cents sides + recommendation reflect it.
    const hs = q.halfSpread;
    const pUpAsk = Math.min(0.995, Math.max(0.005, ratchetedMid + hs));
    const pDownAsk = Math.min(0.995, Math.max(0.005, (1 - ratchetedMid) + hs));
    // Rebuild recommendation from the SAME ratchetedMid the UI odds display,
    // so BET UP/DOWN chip and UP/DN American odds can never disagree.
    const recommendation = buildRecommendation({
      mid: ratchetedMid,
      pillTilt: pTiltNow,
      momTilt: tilt,
      secondsToClose,
      spot,
      strike,
      midPrice: midPrice ?? null,
      buyPrice: buyPrice ?? null,
      sellPrice: sellPrice ?? null,
    });
    const out: OurQuote = {
      ...q,
      mid: ratchetedMid,
      pUpAsk,
      pDownAsk,
      upCents: pUpAsk * 100,
      downCents: pDownAsk * 100,
      recommendation,
    };

    lastGoodRef.current = out;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, strike, secondsToClose, closes1m, midPrice, buyPrice, sellPrice]);
}
