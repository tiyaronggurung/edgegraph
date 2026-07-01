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
