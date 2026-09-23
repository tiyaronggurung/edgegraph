// Tracks how long the current agreement side has held and logs a sample every
// 10 seconds into btc_agreement_log. Best-effort: failures are dropped.
//
// Purely additive — it observes values the agreement panel already computes
// and writes only to its own table.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordAgreementSnapshot, type Side } from "@/lib/agreementLog.functions";

export interface AgreementInput {
  windowStart: number;
  secondsToClose: number | null;
  spot: number | null;
  strike: number | null;
  oddsSide: Side;
  oddsPUp: number | null;
  volSide: Side;
  volImbalance: number | null;
  modelSide: Side;
  modelConfidence: number | null;
  studySide: Side;
  studyConfidence: number | null;
  agreeCount: number;
  agreedSide: Side;
  allFour: boolean;
}

const BUCKET_MS = 10_000;

/** @returns seconds the current 4/4 agreement has held (0 when not 4/4). */
export function useAgreementRecorder(input: AgreementInput, enabled = true): number {
  const recordFn = useServerFn(recordAgreementSnapshot);

  // Hold clock: resets whenever the agreed side changes or 4/4 breaks.
  const holdRef = useRef<{ side: Side; allFour: boolean; at: number }>({
    side: input.agreedSide,
    allFour: input.allFour,
    at: Date.now(),
  });
  if (holdRef.current.side !== input.agreedSide || holdRef.current.allFour !== input.allFour) {
    holdRef.current = { side: input.agreedSide, allFour: input.allFour, at: Date.now() };
  }
  const heldSeconds = input.allFour
    ? Math.floor((Date.now() - holdRef.current.at) / 1000)
    : 0;

  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const inputRef = useRef(input);
  inputRef.current = input;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const sentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => {
      if (!enabledRef.current) return;
      const v = inputRef.current;
      // Only log samples where all four legs are readable — a partial read
      // tells us nothing about agreement.
      if (v.agreeCount < 4) return;
      const bucketSec = Math.floor(Date.now() / BUCKET_MS) * (BUCKET_MS / 1000);
      const key = `${v.windowStart}:${bucketSec}`;
      if (sentRef.current.has(key)) return;
      sentRef.current.add(key);
      if (sentRef.current.size > 400) {
        sentRef.current = new Set(Array.from(sentRef.current).slice(-200));
      }
      const held = v.allFour ? Math.floor((Date.now() - holdRef.current.at) / 1000) : 0;
      void recordFn({
        data: {
          windowStart: v.windowStart,
          bucketSec,
          secondsToClose: v.secondsToClose,
          spot: v.spot,
          strike: v.strike,
          oddsSide: v.oddsSide,
          oddsPUp: v.oddsPUp,
          volSide: v.volSide,
          volImbalance: v.volImbalance,
          modelSide: v.modelSide,
          modelConfidence: v.modelConfidence,
          studySide: v.studySide,
          studyConfidence: v.studyConfidence,
          agreeCount: v.agreeCount,
          agreedSide: v.agreedSide,
          allFour: v.allFour,
          heldSeconds: held,
        },
      }).catch(() => {});
    }, 2_000);
    return () => clearInterval(id);
  }, [recordFn]);

  return heldSeconds;
}
