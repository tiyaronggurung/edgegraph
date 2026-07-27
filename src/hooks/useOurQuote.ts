import { useEffect, useMemo, useRef } from "react";
import {
  computeOurQuote,
  effectiveVol,
  momentumTilt,
  type TapeSample,
} from "@/lib/ourOdds";


const TAPE_MAX = 900;         // ~5 min of ticks at ~300ms cadence
const TAPE_MIN_DT_MS = 250;

export function useOurQuote(params: {
  spot: number | null | undefined;
  strike: number | null | undefined;
  secondsToClose: number | null | undefined;
  closes1m: number[];
  midPrice?: number | null | undefined;
}) {
  const { spot, strike, secondsToClose, closes1m, midPrice } = params;

  const tapeRef = useRef<TapeSample[]>([]);
  const lastGoodRef = useRef<ReturnType<typeof computeOurQuote> | null>(null);
  const lastStrikeRef = useRef<number | null | undefined>(strike);

  // Reset carry on new window (strike change): kills stale quote flash.
  useEffect(() => {
    if (lastStrikeRef.current !== strike) {
      lastStrikeRef.current = strike;
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
    const q = computeOurQuote({
      spot,
      strike,
      secondsToClose,
      sigmaAnnualized: sigma,
      momentumTiltPct: tilt,
      midPrice: midPrice ?? null,
    });

    if (q) lastGoodRef.current = q;
    return q ?? lastGoodRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, strike, secondsToClose, closes1m, midPrice]);
}


