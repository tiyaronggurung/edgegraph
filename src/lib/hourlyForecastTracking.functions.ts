import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sideSchema = z.enum(["UP", "DOWN"]);
const checkpointSchema = z.enum(["OPEN", "STUDY_LOCK", "T30", "T15", "T5", "CLOSE"]);
const ladderSchema = z.array(z.object({
  target: z.number().positive(),
  aboveProbability: z.number().min(0).max(1),
  belowProbability: z.number().min(0).max(1),
  distanceUsd: z.number(),
})).min(1).max(20);

const captureSchema = z.object({
  windowStart: z.number().int().positive(),
  windowEnd: z.number().int().positive(),
  checkpoint: checkpointSchema,
  spot: z.number().positive(),
  hourlyOpen: z.number().positive(),
  expectedMoveUsd: z.number().positive(),
  realizedVolatility: z.number().nonnegative(),
  volatilityRegime: z.enum(["LOW", "NORMAL", "HIGH"]),
  volumeRatio: z.number().nonnegative().nullable(),
  buy: z.number().positive().nullable(),
  mid: z.number().positive().nullable(),
  sell: z.number().positive().nullable(),
  model: z.object({ side: sideSchema, confidence: z.number().min(0).max(1), lockedAt: z.number() }).nullable(),
  study: z.object({ side: sideSchema, confidence: z.number().min(0).max(1), lockedAt: z.number() }).nullable(),
  verdict: z.enum(["AGREE", "DISAGREE", "STUDYING", "INSUFFICIENT_DATA"]),
  ladder: ladderSchema,
  dataAsOf: z.number().nullable(),
  modelVersion: z.string().min(1).max(80),
  priorWindowEnd: z.number().int().positive().nullable(),
  priorCloseSpot: z.number().positive().nullable(),
});

export type HourlyCheckpoint = z.infer<typeof checkpointSchema>;

export interface HourlyScoreRow {
  label: string;
  n: number;
  wins: number;
  hitRate: number;
}

export interface HourlyVolatilityRow {
  regime: string;
  n: number;
  predicted: number;
  actual: number;
  brier: number;
}

export interface HourlyScorecard {
  settledHours: number;
  signals: HourlyScoreRow[];
  volatility: HourlyVolatilityRow[];
  bestSignal: string | null;
  lastSettledAt: string | null;
}

export function checkpointFor(secondsLeft: number, elapsedSeconds: number): HourlyCheckpoint | null {
  if (elapsedSeconds <= 75) return "OPEN";
  if (elapsedSeconds >= 14 * 60 && elapsedSeconds <= 16 * 60) return "STUDY_LOCK";
  if (secondsLeft >= 29 * 60 && secondsLeft <= 31 * 60) return "T30";
  if (secondsLeft >= 14 * 60 && secondsLeft <= 16 * 60) return "T15";
  if (secondsLeft >= 4 * 60 && secondsLeft <= 6 * 60) return "T5";
  if (secondsLeft <= 75) return "CLOSE";
  return null;
}

export const captureHourlyForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => captureSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.priorWindowEnd && data.priorCloseSpot) {
      const settledAt = new Date().toISOString();
      const { error: settleError } = await supabaseAdmin
        .from("btc_hourly_forecast_snapshots")
        .update({ close_spot: data.priorCloseSpot, settled_at: settledAt })
        .eq("window_end", new Date(data.priorWindowEnd).toISOString())
        .is("settled_at", null);
      if (settleError) throw new Error(settleError.message);
    }

    const row = {
      window_start: new Date(data.windowStart).toISOString(),
      window_end: new Date(data.windowEnd).toISOString(),
      checkpoint: data.checkpoint,
      spot: data.spot,
      hourly_open: data.hourlyOpen,
      expected_move_usd: data.expectedMoveUsd,
      realized_vol_1m: data.realizedVolatility,
      volatility_regime: data.volatilityRegime,
      volume_ratio: data.volumeRatio,
      buy_level: data.buy,
      mid_level: data.mid,
      sell_level: data.sell,
      model_side: data.model?.side ?? null,
      model_confidence: data.model?.confidence ?? null,
      model_locked_at: data.model ? new Date(data.model.lockedAt).toISOString() : null,
      study_side: data.study?.side ?? null,
      study_confidence: data.study?.confidence ?? null,
      study_locked_at: data.study ? new Date(data.study.lockedAt).toISOString() : null,
      trendline_mid_side: data.mid == null ? null : data.spot >= data.mid ? "UP" : "DOWN",
      verdict: data.verdict,
      ladder: data.ladder,
      data_as_of: data.dataAsOf ? new Date(data.dataAsOf).toISOString() : null,
      model_version: data.modelVersion,
    };
    const { error } = await supabaseAdmin
      .from("btc_hourly_forecast_snapshots")
      .upsert(row, { onConflict: "window_start,checkpoint", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { recorded: true, checkpoint: data.checkpoint };
  });

export const getHourlyForecastScorecard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HourlyScorecard> => {
    const { data, error } = await context.supabase
      .from("btc_hourly_forecast_snapshots")
      .select("window_start,checkpoint,spot,hourly_open,model_side,study_side,model_confidence,study_confidence,mid_level,trendline_mid_side,verdict,ladder,close_spot,volatility_regime,settled_at")
      .not("settled_at", "is", null)
      .order("settled_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const representative = rows.filter((row) => row.checkpoint === "STUDY_LOCK" || row.checkpoint === "T30");
    const unique = new Map<string, typeof representative[number]>();
    for (const row of representative) if (!unique.has(row.window_start)) unique.set(row.window_start, row);
    const hours = [...unique.values()];

    const score = (label: string, eligible: (row: typeof hours[number]) => boolean, side: (row: typeof hours[number]) => "UP" | "DOWN" | null): HourlyScoreRow => {
      const sample = hours.filter(eligible).map((row) => ({ row, side: side(row) })).filter((item) => item.side != null);
      const wins = sample.filter(({ row, side: picked }) => {
        const actual = Number(row.close_spot) >= Number(row.hourly_open) ? "UP" : "DOWN";
        return picked === actual;
      }).length;
      return { label, n: sample.length, wins, hitRate: sample.length ? wins / sample.length : 0 };
    };

    const signals = [
      score("Frozen Model", () => true, (row) => row.model_side as "UP" | "DOWN" | null),
      score("Locked Study", () => true, (row) => row.study_side as "UP" | "DOWN" | null),
      score("Model + Study agree", (row) => row.verdict === "AGREE", (row) => row.study_side as "UP" | "DOWN" | null),
      score("Study + MID", (row) => row.study_side != null && row.study_side === row.trendline_mid_side, (row) => row.study_side as "UP" | "DOWN" | null),
      score("Full agreement", (row) => row.verdict === "AGREE" && row.study_side === row.trendline_mid_side, (row) => row.study_side as "UP" | "DOWN" | null),
    ];

    const ladderRows = rows.flatMap((row) => {
      const ladder = Array.isArray(row.ladder) ? row.ladder : [];
      return ladder.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || !("target" in entry) || !("aboveProbability" in entry)) return [];
        const target = Number(entry.target);
        const probability = Number(entry.aboveProbability);
        if (!Number.isFinite(target) || !Number.isFinite(probability)) return [];
        return [{ regime: row.volatility_regime, probability, outcome: Number(row.close_spot) >= target ? 1 : 0 }];
      });
    });
    const volatility = ["LOW", "NORMAL", "HIGH"].map((regime) => {
      const sample = ladderRows.filter((row) => row.regime === regime);
      const predicted = sample.length ? sample.reduce((sum, row) => sum + row.probability, 0) / sample.length : 0;
      const actual = sample.length ? sample.reduce((sum, row) => sum + row.outcome, 0) / sample.length : 0;
      const brier = sample.length ? sample.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0) / sample.length : 0;
      return { regime, n: sample.length, predicted, actual, brier };
    });
    const eligibleBest = signals.filter((row) => row.n >= 10).sort((a, b) => b.hitRate - a.hitRate);
    return {
      settledHours: hours.length,
      signals,
      volatility,
      bestSignal: eligibleBest[0]?.label ?? null,
      lastSettledAt: rows[0]?.settled_at ?? null,
    };
  });