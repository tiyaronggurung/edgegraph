import { useEffect, useMemo, useRef } from "react";
import {
  computeOurQuote,
  effectiveVol,
  momentumTilt,
  midPivotTilt,
  type TapeSample,
} from "@/lib/ourOdds";

const TAPE_MAX = 240;
const TAPE_MIN_DT_MS = 250;

/**
 * Single source of truth for "our" UP/DOWN odds quote.
 * Both the top OURS pill and the chart pulse-dot pills consume this so
 * they never disagree.
 */
export function useOurQuote(params: {
  spot: number | null | undefined;
  strike: number | null | undefined;
  secondsToClose: number | null | undefined;
  closes1m: number[];
  midPrice?: number | null | undefined;
}) {
  const { spot, strike, secondsToClose, closes1m, midPrice } = params;

  const tapeRef = useRef<TapeSample[]>([]);
  useEffect(() => {
    if (spot == null || !Number.isFinite(spot) || !(spot > 0)) return;
    const now = Date.now();
    const tape = tapeRef.current;
    const last = tape[tape.length - 1];
    if (last && now - last.t < TAPE_MIN_DT_MS) return;
    tape.push({ t: now, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
  }, [spot]);

  const lastGoodRef = useRef<ReturnType<typeof computeOurQuote> | null>(null);

  return useMemo(() => {
    if (spot == null || strike == null || secondsToClose == null) {
      return lastGoodRef.current;
    }
    const tape = tapeRef.current;
    const sigma = effectiveVol(tape, closes1m, secondsToClose);
    if (sigma == null) return lastGoodRef.current;
    const tilt = momentumTilt(tape, 60_000, secondsToClose);
    const pivTilt = midPivotTilt(spot, midPrice ?? null, secondsToClose);
    const q = computeOurQuote({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
      momentumTiltPct: tilt,
      midPivotTiltPct: pivTilt,
    });
    if (q) lastGoodRef.current = q;
    return q ?? lastGoodRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, strike, secondsToClose, closes1m, midPrice]);
}

