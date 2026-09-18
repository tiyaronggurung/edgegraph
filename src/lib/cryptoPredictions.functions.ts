// Server-fn wrapper for prediction stats. Handler body is stripped from
// client bundle; the .server import stays server-only.
import { createServerFn } from "@tanstack/react-start";
import type { PredictionStatsResult } from "./cryptoPredictions.server";

export type { PredictionStatsResult };

export const getPredictionStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<PredictionStatsResult> => {
    const { computePredictionStats } = await import("./cryptoPredictions.server");
    return computePredictionStats();
  },
);

// ---- Prediction log coverage audit (read-only) ----
// Every BTC 15m window should produce exactly one btc_model_predictions row.
// Logging is driven by the live tick, so gaps appear whenever nothing was
// running. This reports which close_times are missing over the last 24h.
export interface PredictionCoverageResult {
  now: string;
  /** close_time of the window currently in progress */
  currentClose: string;
  /** true when the in-progress window already has a row */
  currentLogged: boolean;
  /** seconds until the current window closes */
  currentSecondsLeft: number;
  lastLoggedClose: string | null;
  expected24h: number;
  logged24h: number;
  /** missing close_times (ISO), newest first, excluding the in-progress window */
  missing: string[];
  /** longest consecutive run of missing windows in the last 24h */
  longestGap: number;
}

export const getPredictionCoverage = createServerFn({ method: "GET" }).handler(
  async (): Promise<PredictionCoverageResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const QUARTER = 15 * 60 * 1000;
    const now = Date.now();
    const currentClose = Math.ceil(now / QUARTER) * QUARTER;
    const since = currentClose - 24 * 60 * 60 * 1000;

    const { data } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("close_time")
      .gte("close_time", new Date(since).toISOString())
      .order("close_time", { ascending: false });

    const have = new Set<number>();
    for (const r of data ?? []) {
      const t = r.close_time ? new Date(r.close_time as string).getTime() : NaN;
      if (Number.isFinite(t)) have.add(Math.round(t / QUARTER) * QUARTER);
    }

    const expectedTimes: number[] = [];
    for (let t = since + QUARTER; t <= currentClose; t += QUARTER) expectedTimes.push(t);

    const missing: string[] = [];
    let longestGap = 0;
    let run = 0;
    for (const t of expectedTimes) {
      const ok = have.has(t);
      if (!ok && t !== currentClose) {
        missing.push(new Date(t).toISOString());
        run++;
        if (run > longestGap) longestGap = run;
      } else {
        run = 0;
      }
    }
    missing.reverse();

    const loggedTimes = [...have].filter(t => t <= currentClose).sort((a, b) => b - a);

    return {
      now: new Date(now).toISOString(),
      currentClose: new Date(currentClose).toISOString(),
      currentLogged: have.has(currentClose),
      currentSecondsLeft: Math.max(0, Math.round((currentClose - now) / 1000)),
      lastLoggedClose: loggedTimes.length ? new Date(loggedTimes[0]!).toISOString() : null,
      expected24h: expectedTimes.length - 1,
      logged24h: expectedTimes.filter(t => t !== currentClose && have.has(t)).length,
      missing,
      longestGap,
    };
  },
);

export interface CalibrationRow {
  time_bucket: string;
  sigma_bucket: string;
  n_samples: number;
  n_correct: number;
  avg_model_prob: number | null;
  avg_market_prob: number | null;
  avg_theory_prob: number | null;
  actual_rate: number | null;
  correction_factor: number;
  last_fitted_at: string | null;
}

export const getCalibrationReport = createServerFn({ method: "GET" }).handler(
  async (): Promise<CalibrationRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("btc_calibration")
      .select("time_bucket, sigma_bucket, n_samples, n_correct, avg_model_prob, avg_market_prob, avg_theory_prob, actual_rate, correction_factor, last_fitted_at")
      .order("time_bucket", { ascending: true })
      .order("sigma_bucket", { ascending: true });
    return (data ?? []).map(r => ({
      time_bucket: r.time_bucket as string,
      sigma_bucket: r.sigma_bucket as string,
      n_samples: Number(r.n_samples ?? 0),
      n_correct: Number(r.n_correct ?? 0),
      avg_model_prob: r.avg_model_prob != null ? Number(r.avg_model_prob) : null,
      avg_market_prob: r.avg_market_prob != null ? Number(r.avg_market_prob) : null,
      avg_theory_prob: r.avg_theory_prob != null ? Number(r.avg_theory_prob) : null,
      actual_rate: r.actual_rate != null ? Number(r.actual_rate) : null,
      correction_factor: Number(r.correction_factor ?? 1),
      last_fitted_at: (r.last_fitted_at as string | null) ?? null,
    }));
  },
);
