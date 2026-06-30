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
