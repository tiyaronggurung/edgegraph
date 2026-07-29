import { useEffect, useMemo, useRef } from "react";
import {
  buildRecommendation,
  computeOurQuote,
  computeUpProbability,
  effectiveVol,
  momentumTilt,
  pillGateTilt,
  type TapeSample,
  type OurQuote,
} from "@/lib/ourOdds";

// Physics sanity cap: the ratcheted+biased mid may drift up to this many ¢
// away from the pure spot-vs-strike BS probability. Since computeOurQuote
// now uses spot-vs-strike as the ANCHOR (not blended with MID), this cap
// only bounds how far MID pivot + persistent bias + breakouts can stack on
// top of physics. Wider than before because the anchor itself is honest.
const PHYSICS_CAP = 0.20;



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

// Per-window warmup on strike rollover: blank the pill until we have fresh
// evidence on the NEW strike. Prevents leftover mid / bias / memory-driven
// signals from the previous 15m window bleeding into the first seconds of
// the next window.
const WARMUP_MIN_MS = 2500;
const WARMUP_MIN_TICKS = 5;

interface WindowState {
  strike: number;
  maxMid: number;              // best (highest) mid seen this window
  minMid: number;              // best (lowest) mid seen this window
  lastSpotSide: 1 | -1 | 0;    // sign(spot - strike) at last tick
  bias: number;                // persistent trendline bias (prob units)
  lastTs: number;
  // --- side-memory lock (per-window candle-read memory) ---
  memory: number;              // signed [-1..1], accumulates candle direction
  lockedSide: 1 | -1 | 0;      // 0 = no lock, ±1 = hard-locked side
  oppositeStreakSec: number;   // seconds physics has voted opposite the lock
  // --- rolling spot-side series for anti-fakeout ---
  sideHist: Array<{ t: number; above: boolean }>;
  // --- per-window warmup on strike change ---
  strikeChangedAt: number;     // ms timestamp when this new strike appeared
  postStrikeTicks: number;     // spot ticks recorded since strike change
}


export function useOurQuote(params: {
  spot: number | null | undefined;
  strike: number | null | undefined;
  secondsToClose: number | null | undefined;
  closes1m: number[];
  midPrice?: number | null | undefined;
  buyPrice?: number | null | undefined;
  sellPrice?: number | null | undefined;
  /** Binance taker buy/sell imbalance over trailing 3m, signed -1..+1. */
  volumeImbalance3m?: number | null | undefined;
}) {
  const { spot, strike, secondsToClose, closes1m, midPrice, buyPrice, sellPrice, volumeImbalance3m } = params;

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
        memory: 0,
        lockedSide: 0,
        oppositeStreakSec: 0,
        sideHist: [],
        strikeChangedAt: Date.now(),
        postStrikeTicks: 0,
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
        memory: 0,
        lockedSide: 0,
        oppositeStreakSec: 0,
        sideHist: [],
        strikeChangedAt: Date.now(),
        postStrikeTicks: 0,
      };
      winRef.current = win;
    }
    const w: WindowState = win; // narrow for TS

    // ---- Per-window warmup on new strike ---------------------------------
    // Blank the pill until (a) ≥ WARMUP_MIN_MS have elapsed since strike change
    // AND (b) we have ≥ WARMUP_MIN_TICKS fresh spot ticks on the new strike.
    // Skip all bias / ratchet / memory updates during warmup so the first real
    // quote starts clean from pure physics on the new strike.
    const nowW = Date.now();
    w.postStrikeTicks += 1;
    const warmupElapsed = nowW - w.strikeChangedAt;
    if (warmupElapsed < WARMUP_MIN_MS || w.postStrikeTicks < WARMUP_MIN_TICKS) {
      w.lastTs = nowW;
      return null;
    }

    // Persistent trendline bias: accumulate signed pill-gate + momentum every
    // tick, decay very slowly.
    const now = nowW;
    const dtSec = Math.max(0, (now - w.lastTs) / 1000);
    w.lastTs = now;
    const decay = Math.pow(BIAS_DECAY_PER_S, dtSec);
    w.bias *= decay;
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
      w.bias = Math.max(-BIAS_MAX, Math.min(BIAS_MAX, w.bias + agreeSign * BIAS_STEP));
    }

    // Compose base momentum with persistent bias so downstream tilt survives.
    const compositeTilt = Math.max(-0.10, Math.min(0.10, tilt + w.bias));

    const q = computeOurQuote({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
      momentumTiltPct: compositeTilt,
      midPrice: midPrice ?? null,
      buyPrice: buyPrice ?? null,
      sellPrice: sellPrice ?? null,
      volumeImbalance3m: volumeImbalance3m ?? null,
    });

    if (!q) return lastGoodRef.current;

    // ---- Ratchet: never reset to 50/50 unless spot actually crosses strike ----
    const spotSide: 1 | -1 | 0 = spot > strike ? 1 : spot < strike ? -1 : 0;
    const crossed = spotSide !== 0 && w.lastSpotSide !== 0 && spotSide !== w.lastSpotSide;
    if (crossed) {
      if (spotSide > 0) w.minMid = 0.5;
      else w.maxMid = 0.5;
    }
    if (spotSide !== 0) w.lastSpotSide = spotSide;

    // Register new extremes.
    if (q.mid > w.maxMid) w.maxMid = q.mid;
    if (q.mid < w.minMid) w.minMid = q.mid;

    // Floor / ceiling from ratchet: allow at most GIVEBACK_FRAC retrace toward 0.5.
    const upFloor = 0.5 + (w.maxMid - 0.5) * (1 - GIVEBACK_FRAC);
    const dnCeil  = 0.5 - (0.5 - w.minMid) * (1 - GIVEBACK_FRAC);

    let ratchetedMid = q.mid;
    if (w.maxMid - 0.5 >= 0.5 - w.minMid) {
      ratchetedMid = Math.max(ratchetedMid, upFloor);
    }
    if (0.5 - w.minMid > w.maxMid - 0.5) {
      ratchetedMid = Math.min(ratchetedMid, dnCeil);
    }
    ratchetedMid = Math.min(0.99, Math.max(0.01, ratchetedMid));

    // ---- Physics sanity cap ------------------------------------------------
    const physicsMid = computeUpProbability({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
    });
    if (physicsMid != null) {
      const lo = Math.max(0.01, physicsMid - PHYSICS_CAP);
      const hi = Math.min(0.99, physicsMid + PHYSICS_CAP);
      ratchetedMid = Math.min(hi, Math.max(lo, ratchetedMid));
    }

    // ---- Anti-fakeout: rolling spot-side ratio over last 90s ----------------
    // If price has been on one side of strike ≥70% of the last 90s, the MID
    // pivot / brief crossings cannot pull the pill to the opposite side. This
    // fixes the "$9-22 above strike but pill says DOWN" bug after a 1-2 tick
    // fake cross.
    w.sideHist.push({ t: now, above: spot > strike });
    const histCutoff = now - 120_000;
    while (w.sideHist.length && w.sideHist[0].t < histCutoff) w.sideHist.shift();
    const recentCut = now - 90_000;
    const recent = w.sideHist.filter((x) => x.t >= recentCut);
    let aboveRatio: number | null = null;
    if (recent.length >= 10) {
      const above = recent.filter((x) => x.above).length;
      aboveRatio = above / recent.length;
      if (physicsMid != null) {
        // 70% up-time + currently above → never quote below physics
        if (aboveRatio >= 0.70 && spotSide > 0) {
          ratchetedMid = Math.max(ratchetedMid, physicsMid);
        }
        // 70% down-time + currently below → never quote above physics
        if (aboveRatio <= 0.30 && spotSide < 0) {
          ratchetedMid = Math.min(ratchetedMid, physicsMid);
        }
      }
    }

    // ---- Per-window side memory + hard lock (candle-read persistence) --------
    // Accumulates signed "who is winning this window" score from physics +
    // momentum every tick. Once |memory| ≥ 0.55 sustained, hard-locks the pill
    // to that side (floors mid at 0.55 or ceils at 0.45). MID pivot and brief
    // fake-outs can no longer flip the recommended side. Unlock only after
    // 90s of sustained opposing physics.
    if (physicsMid != null) {
      const physSig = physicsMid - 0.5;                // signed evidence, ±0.5
      const momSig = tilt;                             // signed momentum, ±0.03
      const stepPerSec = Math.sign(physSig) * Math.min(0.04, Math.abs(physSig) * 0.4)
                      + Math.sign(momSig) * Math.min(0.02, Math.abs(momSig) * 0.5);
      // Slow decay (half-life ~10 min) so memory persists but doesn't run away.
      const memDecay = Math.pow(0.5, dtSec / 600);
      w.memory = Math.max(-1, Math.min(1,
        w.memory * memDecay + stepPerSec * Math.min(dtSec, 3),
      ));

      // Lock trigger.
      if (w.lockedSide === 0 && Math.abs(w.memory) >= 0.55) {
        w.lockedSide = w.memory > 0 ? 1 : -1;
        w.oppositeStreakSec = 0;
      }
      // Track sustained opposing physics for unlock.
      if (w.lockedSide !== 0) {
        const physSide = physSig > 0 ? 1 : physSig < 0 ? -1 : 0;
        if (physSide !== 0 && physSide !== w.lockedSide) {
          w.oppositeStreakSec += dtSec;
        } else {
          w.oppositeStreakSec = Math.max(0, w.oppositeStreakSec - dtSec);
        }
        if (w.oppositeStreakSec >= 90) {
          // Reversal earned: release the lock; memory follows through naturally.
          w.lockedSide = 0;
          w.memory = 0;
          w.oppositeStreakSec = 0;
        }
      }

      // Apply lock: prevent the pill from flipping to the opposite side.
      if (w.lockedSide > 0) {
        ratchetedMid = Math.max(ratchetedMid, 0.55);
      } else if (w.lockedSide < 0) {
        ratchetedMid = Math.min(ratchetedMid, 0.45);
      }
      ratchetedMid = Math.min(0.99, Math.max(0.01, ratchetedMid));
    }



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
