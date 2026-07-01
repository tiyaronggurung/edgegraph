import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getRollingCalibration, computeShift, type CalibrationResult } from "@/lib/rollingCalibration.functions";

export interface UseCalibrationShift {
  calibration: CalibrationResult | undefined;
  isLoading: boolean;
  shift: number;               // 0 when disabled or not ready
  note: string;
  ready: boolean;
  adjustedScore: number;
}

export function useCalibrationShift(liveScore: number, enabled: boolean): UseCalibrationShift {
  const fn = useServerFn(getRollingCalibration);
  const q = useQuery({
    queryKey: ["btc-calibration"],
    queryFn: () => fn(),
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const { shift, note, ready } = useMemo(
    () => (enabled ? computeShift(q.data, liveScore) : { shift: 0, note: "off", ready: false }),
    [q.data, liveScore, enabled],
  );
  return {
    calibration: q.data,
    isLoading: q.isLoading,
    shift,
    note,
    ready,
    adjustedScore: Math.max(0, Math.min(100, liveScore + shift)),
  };
}
