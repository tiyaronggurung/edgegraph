// Server-fn wrapper for prediction-tracking helpers. Handler bodies are stripped
// from client bundles; the .server import stays server-only.
import { createServerFn } from "@tanstack/react-start";
import type { SnapshotInput, PredictionStatsResult } from "./cryptoPredictions.server";

export type { SnapshotInput, PredictionStatsResult };

export async function snapshotPrediction(input: SnapshotInput): Promise<void> {
  const { snapshotPrediction: fn } = await import("./cryptoPredictions.server");
  return fn(input);
}

export async function settleDuePredictions(): Promise<{ settled: number }> {
  const { settleDuePredictions: fn } = await import("./cryptoPredictions.server");
  return fn();
}

export const getPredictionStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<PredictionStatsResult> => {
    const { computePredictionStats } = await import("./cryptoPredictions.server");
    return computePredictionStats();
  },
);
