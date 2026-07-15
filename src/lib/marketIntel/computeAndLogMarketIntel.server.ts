// Server-only orchestrator: computes MarketIntel + persists one row per
// prediction/decision event. Shadow-only. Never throws. Never blocks the
// caller. Fully deterministic for a given input.
//
// This file is *.server.ts to guarantee it can never be imported into a
// client bundle.

import type { Candle, MarketIntel, MarketIntelStatus } from "./types";
import { MARKET_INTEL_VERSION } from "./types";
import { computeMarketIntel } from "./combine";
import { deriveWindowFields, type SettlementLinkStatus, type TimeBucket } from "./windowMapping";

export interface ComputeAndLogInput {
  /** May be null for global (system-wide) predictions like the BTC 15-min market. */
  userId: string | null;
  ticker: string;
  strike: number;
  spot: number;
  closeTime: string;                // ISO
  decisionTs: Date;                 // when the prediction was generated
  secondsToClose: number;
  candles1m: Candle[];
  candles5m: Candle[];
  candles15m?: Candle[];
  predictionId?: string | null;
  /** For tests: inject a custom persistence function. */
  inserter?: Inserter;
  /** For tests: inject env overrides. */
  env?: EnvConfig;
}

export interface ComputeAndLogResult {
  status: MarketIntelStatus | "skipped_disabled" | "skipped_sample" | "skipped_min_interval";
  intel: MarketIntel | null;
  inserted: boolean;
  reason?: string;
  calculationDurationMs: number;
  inputLagMs: number;
}

type EnvConfig = {
  shadowEnabled: boolean;
  sampleRate: number;
  minLogIntervalMs: number;
};

type InserterRow = {
  user_id: string | null;
  prediction_id: string | null;
  ticker: string;
  window_start: string;
  close_time: string;
  decision_ts: string;
  market_intel_version: string;
  direction: string;
  confidence: number;
  market_state: string;
  structure_direction: string;
  structure_strength: number;
  continuation_score: number;
  reversal_score: number;
  exhaustion_score: number;
  chop_score: number;
  compression_score: number;
  expansion_score: number;
  sequence_state: string | null;
  volatility_regime: string;
  expected_move_15m_usd: number;
  expected_move_15m_pct: number;
  strike_distance_usd: number;
  strike_distance_in_expected_moves: number;
  spot_at_compute: number;
  strike: number;
  status: string;
  calculation_duration_ms: number;
  input_lag_ms: number;
  nearest_psych_level: number | null;
  psych_level_interval: number | null;
  psych_level_role: string | null;
  psych_level_strength: number | null;
  psych_distance_usd: number | null;
  psych_distance_atr: number | null;
  psych_state: string | null;
  round_confluence_score: number | null;
  market_window_id: string | null;
  window_open_ts: string | null;
  window_close_ts: string | null;
  seconds_to_close: number | null;
  time_bucket: TimeBucket | null;
  settlement_link_status: SettlementLinkStatus;
  signals_jsonb: unknown;
  reasons_jsonb: unknown;
  warnings_jsonb: unknown;
};

export type Inserter = (row: InserterRow) => Promise<{ inserted: boolean; error?: string }>;

// In-memory throttle map (per-user+ticker). Server-worker scoped.
const lastLogAt = new Map<string, number>();

function readEnv(): EnvConfig {
  const shadowEnabled = (process.env.MARKET_INTEL_SHADOW_ENABLED ?? "true").toLowerCase() !== "false";
  const sampleRate = Number(process.env.MARKET_INTEL_LOG_SAMPLE_RATE ?? "1");
  const minLogIntervalMs = Number(process.env.MARKET_INTEL_MIN_LOG_INTERVAL_MS ?? "30000");
  return {
    shadowEnabled,
    sampleRate: Number.isFinite(sampleRate) ? Math.max(0, Math.min(1, sampleRate)) : 1,
    minLogIntervalMs: Number.isFinite(minLogIntervalMs) ? Math.max(0, minLogIntervalMs) : 30_000,
  };
}

/** Deterministic sanitizer: dedupe by open time, drop unclosed and future candles, sort ascending. */
function sanitizeCandles(candles: Candle[] | undefined, cutoffMs: number): Candle[] {
  if (!candles || candles.length === 0) return [];
  const byT = new Map<number, Candle>();
  for (const c of candles) {
    if (!c || !c.closed) continue;
    if (!Number.isFinite(c.t) || !Number.isFinite(c.o) || !Number.isFinite(c.h) || !Number.isFinite(c.l) || !Number.isFinite(c.c)) continue;
    // Future candle rejection: candle open time must be strictly before cutoff.
    if (c.t >= cutoffMs) continue;
    // Deduplicate on open time — later duplicate wins deterministically (they should be identical for closed bars).
    byT.set(c.t, c);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

function latestCloseTime(cs: Candle[]): string | null {
  if (cs.length === 0) return null;
  return new Date(cs[cs.length - 1].t).toISOString();
}

async function defaultInserter(row: InserterRow): Promise<{ inserted: boolean; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("btc_market_intel")
      .insert(row as never);
    if (error) {
      // 23505 = unique_violation → idempotent no-op.
      if ((error as { code?: string }).code === "23505") return { inserted: false, error: "duplicate" };
      console.warn(`[marketIntel] insert failed: ${error.message} (code=${(error as { code?: string }).code ?? "?"})`);
      return { inserted: false, error: error.message };
    }
    return { inserted: true };
  } catch (e) {
    console.warn(`[marketIntel] insert threw: ${(e as Error).message}`);
    return { inserted: false, error: (e as Error).message };
  }
}

/**
 * Compute + persist one MarketIntel snapshot. Never throws.
 * Returns a small result object for callers that care to observe.
 */
export async function computeAndLogMarketIntel(input: ComputeAndLogInput): Promise<ComputeAndLogResult> {
  const started = Date.now();
  const env = input.env ?? readEnv();
  const inserter = input.inserter ?? defaultInserter;

  try {
    if (!env.shadowEnabled) {
      return { status: "skipped_disabled", intel: null, inserted: false, calculationDurationMs: 0, inputLagMs: 0 };
    }
    if (env.sampleRate < 1 && Math.random() > env.sampleRate) {
      return { status: "skipped_sample", intel: null, inserted: false, calculationDurationMs: 0, inputLagMs: 0 };
    }
    const throttleKey = `${input.userId}:${input.ticker}`;
    const prev = lastLogAt.get(throttleKey) ?? 0;
    const nowMs = input.decisionTs.getTime();
    if (nowMs - prev < env.minLogIntervalMs) {
      return { status: "skipped_min_interval", intel: null, inserted: false, calculationDurationMs: 0, inputLagMs: 0 };
    }

    // Derive window mapping + settlement-link status from the ticker (Turn 4A).
    const wf = deriveWindowFields({
      ticker: input.ticker,
      decisionTs: input.decisionTs,
      closeTime: input.closeTime,
    });

    // Clone arrays defensively so we never mutate caller data.
    const cutoffMs = input.decisionTs.getTime();
    const c1 = sanitizeCandles([...input.candles1m], cutoffMs);
    const c5 = sanitizeCandles([...input.candles5m], cutoffMs);
    const c15 = sanitizeCandles(input.candles15m ? [...input.candles15m] : [], cutoffMs);

    // Compute (this is the deterministic, testable part).
    const intel = computeMarketIntel({
      spot: input.spot,
      strike: input.strike,
      candles1m: c1,
      candles5m: c5,
      candles15m: c15,
    });

    const calcMs = Date.now() - started;
    const lastCloseMs = c1.length ? c1[c1.length - 1].t : cutoffMs;
    const inputLagMs = Math.max(0, cutoffMs - lastCloseMs);

    const signals = {
      input_cutoff_time: input.decisionTs.toISOString(),
      latest_completed_1m_close_time: latestCloseTime(c1),
      latest_completed_5m_close_time: latestCloseTime(c5),
      latest_completed_15m_close_time: latestCloseTime(c15),
      candle_counts: { "1m": c1.length, "5m": c5.length, "15m": c15.length },
      structure: {
        state: intel.market_state,
        direction: intel.structure_direction,
        strength: intel.structure_strength,
      },
      volatility: {
        regime: intel.volatility_regime,
        expected_move_15m_usd: intel.expected_move_15m_usd,
        expected_move_15m_pct: intel.expected_move_15m_pct,
        strike_distance_usd: intel.strike_distance_usd,
        strike_distance_in_expected_moves: intel.strike_distance_in_expected_moves,
      },
      patterns: intel.detected_patterns,
      sequence: {
        state: intel.sequence_state,
        continuation_score: intel.continuation_score,
        reversal_score: intel.reversal_score,
        exhaustion_score: intel.exhaustion_score,
        chop_score: intel.chop_score,
        compression_score: intel.compression_score,
        expansion_score: intel.expansion_score,
      },
      psychological_levels: intel.psych,
      combiner: {
        direction: intel.direction,
        confidence: intel.confidence,
      },
      data_quality: {
        status: intel.status,
        input_lag_ms: inputLagMs,
        calculation_duration_ms: calcMs,
        missing_1m: c1.length === 0,
        missing_5m: c5.length === 0,
        missing_15m: c15.length === 0,
        insufficient_history: intel.status === "insufficient_data",
      },
      config: {
        shadow_enabled: env.shadowEnabled,
        sample_rate: env.sampleRate,
        min_log_interval_ms: env.minLogIntervalMs,
      },
      versions: intel.component_versions,
    };

    const row: InserterRow = {
      user_id: input.userId,
      prediction_id: input.predictionId ?? null,
      ticker: input.ticker,
      window_start: input.decisionTs.toISOString(),
      close_time: input.closeTime,
      decision_ts: input.decisionTs.toISOString(),
      market_intel_version: MARKET_INTEL_VERSION,
      direction: intel.direction,
      confidence: intel.confidence,
      market_state: intel.market_state,
      structure_direction: intel.structure_direction,
      structure_strength: intel.structure_strength,
      continuation_score: intel.continuation_score,
      reversal_score: intel.reversal_score,
      exhaustion_score: intel.exhaustion_score,
      chop_score: intel.chop_score,
      compression_score: intel.compression_score,
      expansion_score: intel.expansion_score,
      sequence_state: intel.sequence_state,
      volatility_regime: intel.volatility_regime,
      expected_move_15m_usd: intel.expected_move_15m_usd,
      expected_move_15m_pct: intel.expected_move_15m_pct,
      strike_distance_usd: intel.strike_distance_usd,
      strike_distance_in_expected_moves: intel.strike_distance_in_expected_moves,
      spot_at_compute: input.spot,
      strike: input.strike,
      status: intel.status,
      calculation_duration_ms: calcMs,
      input_lag_ms: inputLagMs,
      nearest_psych_level: intel.psych.nearestLevel,
      psych_level_interval: intel.psych.intervalUsd || null,
      psych_level_role: intel.psych.role,
      psych_level_strength: intel.psych.strength,
      psych_distance_usd: intel.psych.distanceUsd,
      psych_distance_atr: intel.psych.distanceAtr,
      psych_state: intel.psych.state,
      round_confluence_score: intel.psych.confluenceScore,
      market_window_id: wf.marketWindowId,
      window_open_ts: wf.windowOpenTs,
      window_close_ts: wf.windowCloseTs,
      seconds_to_close: wf.secondsToClose ?? input.secondsToClose ?? null,
      time_bucket: wf.timeBucket,
      settlement_link_status: wf.settlementLinkStatus,
      signals_jsonb: { ...signals, window_mapping: { ticker_valid: wf.tickerValid, ticker_reason: wf.tickerReason ?? null } },
      reasons_jsonb: intel.reasons,
      warnings_jsonb: intel.warnings,
    };

    let inserted = false;
    let insertErr: string | undefined;
    try {
      const res = await inserter(row);
      inserted = res.inserted;
      insertErr = res.error;
    } catch (e) {
      insertErr = (e as Error).message;
    }

    if (inserted) lastLogAt.set(throttleKey, nowMs);

    return {
      status: intel.status,
      intel,
      inserted,
      reason: insertErr,
      calculationDurationMs: calcMs,
      inputLagMs,
    };
  } catch (e) {
    // Absolute last-resort catch. Shadow logging can never bubble up.
    // eslint-disable-next-line no-console
    console.warn("computeAndLogMarketIntel failed silently:", (e as Error).message);
    return {
      status: "error" as MarketIntelStatus,
      intel: null,
      inserted: false,
      reason: (e as Error).message,
      calculationDurationMs: Date.now() - started,
      inputLagMs: 0,
    };
  }
}

/** Testing helper — clears the in-memory throttle map. */
export function _resetThrottleForTests(): void {
  lastLogAt.clear();
}
