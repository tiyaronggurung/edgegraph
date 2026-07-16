// Server-only: persist a gate decision. Fire-and-forget — NEVER throws to
// the caller. The idempotency index (ticker, source_path, decision_bucket)
// silently drops repeat inserts within the same 60s bucket. A DB failure
// here must not block or affect a live order.
import type { BtcEntryGateDecision, BtcGateConfig, SourcePath } from "./btcEntryGate";

export interface BtcGateLogPayload {
  decision: BtcEntryGateDecision;
  sourcePath: SourcePath;
  ticker: string;
  eventId?: string | null;
  closeTime?: string | null;
  secondsToClose?: number | null;
  modelProb: number;
  yesBid?: number | null; yesAsk?: number | null;
  noBid?: number | null;  noAsk?: number | null;
  calibratedEdgeUpstream?: number | null; // e.g. edge_pts / 100 from other pipelines
  config: BtcGateConfig;
  decisionTsMs?: number;
}

export async function logBtcGateDecision(payload: BtcGateLogPayload): Promise<void> {
  if (!payload.config.log_gate_decisions) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tsMs = payload.decisionTsMs ?? Date.now();
    const bucket = Math.floor(tsMs / 60_000);
    const d = payload.decision;
    const row = {
      ticker: payload.ticker,
      event_id: payload.eventId ?? null,
      decision_ts: new Date(tsMs).toISOString(),
      decision_bucket: bucket,
      close_time: payload.closeTime ?? null,
      seconds_to_close: payload.secondsToClose ?? null,
      source_path: payload.sourcePath,
      locked_side: d.lockedSide,
      live_side: d.liveSide,
      live_side_disagrees: d.liveSideDisagrees,
      model_prob: payload.modelProb,
      side_confidence: d.sideConfidence,
      yes_bid: payload.yesBid ?? null,
      yes_ask: payload.yesAsk ?? null,
      no_bid: payload.noBid ?? null,
      no_ask: payload.noAsk ?? null,
      selected_side_ask: d.selectedSideAsk,
      estimated_fee: d.estimatedFee,
      raw_model_edge: d.rawModelEdge,
      fee_adjusted_edge: d.feeAdjustedEdge,
      slippage_adjusted_edge: d.slippageAdjustedEdge,
      calibrated_edge: d.calibratedEdge ?? payload.calibratedEdgeUpstream ?? null,
      positive_edge_shadow_pass: d.positiveEdgeShadowPass,
      gate_action: d.action,
      side_confidence_passed: d.gates.sideConfidencePassed,
      live_agreement_passed: d.gates.liveAgreementPassed,
      positive_edge_passed: d.gates.positiveEdgePassed,
      primary_reason: d.reason,
      all_reasons: d.allReasons,
      side_conf_threshold: payload.config.min_side_confidence,
      require_live_agreement: payload.config.require_live_side_agreement,
      require_positive_edge: payload.config.positive_edge_mode === "enforced",
      positive_edge_mode: payload.config.positive_edge_mode,
      config_version: payload.config.config_version,
    };
    // Idempotent: unique(ticker, source_path, decision_bucket). Repeat polls
    // inside the same 60s hit the constraint and are silently ignored.
    const { error } = await supabaseAdmin
      .from("btc_gate_decision_log")
      .insert(row);
    // Duplicate-key from idempotency index is expected and non-fatal.
    if (error && !/duplicate key/i.test(error.message)) {
      console.warn("[btcGateLog] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[btcGateLog] unexpected error (swallowed):", (e as Error)?.message ?? e);
  }
}
