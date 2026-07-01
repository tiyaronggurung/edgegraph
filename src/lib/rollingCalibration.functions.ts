// Rolling calibration — Phase 1 of the model accuracy plan.
//
// Reads the user's most recent settled trades that have a stored
// chart_verdict_score, buckets them into 10-wide bins across 0..100,
// then computes a threshold shift the client applies to the live verdict
// score before comparing against the fire threshold.
//
// The shift is clamped to ±8 pts. When sample size is small (< 30 rows
// total or < 10 in-bucket), we return shift = 0 so behavior is identical
// to today. The whole feature is gated by a client-side toggle, so
// nothing happens automatically.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface CalibrationResult {
  ready: boolean;
  sampleSize: number;         // total settled rows with a score
  overallWinRate: number | null;
  bins: Array<{
    lo: number;
    hi: number;
    n: number;
    wins: number;
    winRate: number | null;
  }>;
  updatedAt: string;
}

const N_ROWS = 200;
const BIN_WIDTH = 10;

export const getRollingCalibration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CalibrationResult> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("crypto_trades")
      .select("chart_verdict_score, outcome")
      .eq("user_id", userId)
      .not("chart_verdict_score", "is", null)
      .in("outcome", ["WIN", "LOSS"])
      .order("created_at", { ascending: false })
      .limit(N_ROWS);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ chart_verdict_score: number | null; outcome: string | null }>;

    const bins: CalibrationResult["bins"] = [];
    for (let lo = 0; lo < 100; lo += BIN_WIDTH) {
      bins.push({ lo, hi: lo + BIN_WIDTH, n: 0, wins: 0, winRate: null });
    }
    let wins = 0;
    for (const r of rows) {
      const s = Number(r.chart_verdict_score);
      if (!Number.isFinite(s)) continue;
      const idx = Math.min(bins.length - 1, Math.max(0, Math.floor(s / BIN_WIDTH)));
      bins[idx].n += 1;
      if (r.outcome === "WIN") { bins[idx].wins += 1; wins += 1; }
    }
    for (const b of bins) b.winRate = b.n > 0 ? b.wins / b.n : null;

    return {
      ready: rows.length >= 30,
      sampleSize: rows.length,
      overallWinRate: rows.length > 0 ? wins / rows.length : null,
      bins,
      updatedAt: new Date().toISOString(),
    };
  });

// Pure client-side helper: given the calibration table and a live score,
// derive the shift the client should apply before comparing to threshold.
// Positive shift = model is under-scoring at this bin (we should fire more
// readily); negative shift = model is over-scoring.
export function computeShift(
  cal: CalibrationResult | undefined | null,
  liveScore: number,
): { shift: number; note: string; ready: boolean } {
  if (!cal || !cal.ready) return { shift: 0, note: "calibrating…", ready: false };
  const idx = Math.min(cal.bins.length - 1, Math.max(0, Math.floor(liveScore / BIN_WIDTH)));
  const bin = cal.bins[idx];
  if (!bin || bin.n < 10 || bin.winRate == null || cal.overallWinRate == null) {
    return { shift: 0, note: `bin ${bin?.lo ?? "?"}-${bin?.hi ?? "?"} n=${bin?.n ?? 0}`, ready: true };
  }
  // Convert bin win-rate delta vs baseline into a score shift.
  // 1% edge → 0.5 pt shift; clamp ±8 pts.
  const edge = (bin.winRate - cal.overallWinRate) * 100;
  const shift = Math.max(-8, Math.min(8, edge * 0.5));
  return {
    shift,
    note: `bin ${bin.lo}-${bin.hi} win ${(bin.winRate * 100).toFixed(0)}% vs base ${(cal.overallWinRate * 100).toFixed(0)}% · N=${cal.sampleSize}`,
    ready: true,
  };
}
