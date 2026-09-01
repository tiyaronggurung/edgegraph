// Server-only: dense shadow capture of the live BTC 15m window.
//
// Purpose: the consensus history endpoint could not be backtested because
// observations were sparse — rows only existed when a study lock happened to
// fire. This writes a complete row every ~30s from T-8m through close,
// UNCONDITIONALLY (no study lock required, no gate applied), so that once
// ~200 settled windows have in-band coverage the lean gate can be re-tested
// honestly.
//
// Read-only with respect to trading: places no orders, touches no gate,
// changes no live path. It only INSERTs into btc_window_snapshots.

import { getBtcLevels } from "@/lib/btcLevels.server";

/** Only capture inside the window that matters for entry decisions. */
export const CAPTURE_MAX_SECONDS_TO_CLOSE = 8 * 60; // T-8m
export const CAPTURE_MIN_SECONDS_TO_CLOSE = 0;
export const MAX_KALSHI_SNAPSHOT_AGE_MS = 30_000;

const asSide = (v: unknown): "YES" | "NO" | null => (v === "YES" || v === "NO" ? v : null);

const PRED_COLS =
  "ticker, side, model_prob, model_side_pre_study, study_locked_side, study_lock_confidence, study_locked_at";

export interface CaptureResult {
  ok: boolean;
  captured: boolean;
  ticker: string | null;
  secondsToClose: number | null;
  reason?: string;
  error?: string;
}

export async function captureWindowSnapshot(): Promise<CaptureResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [snapshotRes, levelsRes] = await Promise.allSettled([
    supabaseAdmin
      .from("btc_kalshi_odds_snapshots")
      .select("ticker, strike, snapped_at, seconds_to_close, kalshi_yes_bid, kalshi_yes_ask, spot_composite, kalshi_volume, kalshi_open_interest")
      .order("snapped_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBtcLevels({ limit: 120 }),
  ]);

  const snapshotResult = snapshotRes.status === "fulfilled" ? snapshotRes.value : null;
  const flow = snapshotResult?.data ?? null;
  const levels = levelsRes.status === "fulfilled" ? levelsRes.value : null;

  if (snapshotResult?.error) {
    return {
      ok: false,
      captured: false,
      ticker: null,
      secondsToClose: null,
      error: `stored Kalshi snapshot unavailable: ${snapshotResult.error.message}`,
    };
  }

  if (!flow?.ticker || flow.strike == null || flow.seconds_to_close == null) {
    return { ok: true, captured: false, ticker: flow?.ticker ?? null, secondsToClose: null, reason: "no stored Kalshi snapshot" };
  }

  const snapshotAtMs = Date.parse(flow.snapped_at);
  const snapshotAgeMs = Date.now() - snapshotAtMs;
  if (!Number.isFinite(snapshotAtMs) || snapshotAgeMs < -5_000 || snapshotAgeMs > MAX_KALSHI_SNAPSHOT_AGE_MS) {
    return {
      ok: true,
      captured: false,
      ticker: flow.ticker,
      secondsToClose: flow.seconds_to_close,
      reason: "stored Kalshi snapshot stale",
    };
  }

  const stc = Math.max(0, flow.seconds_to_close - snapshotAgeMs / 1000);
  if (stc > CAPTURE_MAX_SECONDS_TO_CLOSE || stc < CAPTURE_MIN_SECONDS_TO_CLOSE) {
    return { ok: true, captured: false, ticker: flow.ticker, secondsToClose: stc, reason: "outside T-8m..close" };
  }

  const { data: predRow } = await supabaseAdmin
    .from("btc_model_predictions")
    .select(PRED_COLS)
    .eq("ticker", flow.ticker)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = (predRow ?? {}) as Record<string, unknown>;
  const modelSide = asSide(row["model_side_pre_study"]) ?? asSide(row["side"]);
  const modelProbRaw = row["model_prob"] == null ? null : Number(row["model_prob"]);
  const modelConf =
    modelProbRaw == null || !Number.isFinite(modelProbRaw)
      ? null
      : modelSide === "NO"
        ? 1 - modelProbRaw
        : modelProbRaw;

  const studySide = asSide(row["study_locked_side"]);
  const studyConfRaw = row["study_lock_confidence"] == null ? null : Number(row["study_lock_confidence"]);
  const studyConf =
    studyConfRaw == null || !Number.isFinite(studyConfRaw)
      ? null
      : studyConfRaw > 1
        ? studyConfRaw / 100
        : studyConfRaw;

  const storedSpot = flow.spot_composite == null ? null : Number(flow.spot_composite);
  const spot = levels?.ok ? levels.spot : storedSpot;
  const cents = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));
  const yesAskC = cents(flow.kalshi_yes_ask);
  const yesBidC = cents(flow.kalshi_yes_bid);

  const insert = {
    ticker: flow.ticker,
    // Round to the 15m boundary so every row of one window shares a close_time.
    close_time: new Date(Math.round((Date.now() + stc * 1000) / 900_000) * 900_000).toISOString(),
    seconds_to_close: Math.round(stc),
    strike_usd: flow.strike,
    spot_usd: spot,
    cushion_usd: spot != null ? Number((spot - flow.strike).toFixed(2)) : null,
    yes_bid_cents: yesBidC,
    yes_ask_cents: yesAskC,
    // Kalshi's NO book is the complement of the YES book.
    no_bid_cents: yesAskC == null ? null : 100 - yesAskC,
    no_ask_cents: yesBidC == null ? null : 100 - yesBidC,
    volume: flow.kalshi_volume,
    open_interest: flow.kalshi_open_interest,
    trendline_buy: levels?.ok ? levels.buy : null,
    trendline_mid: levels?.ok ? levels.mid : null,
    trendline_sell: levels?.ok ? levels.sell : null,
    trendline_position: levels?.ok ? levels.position : null,
    model_side: modelSide,
    model_confidence: modelConf,
    study_side: studySide,
    study_confidence: studyConf,
    study_locked: Boolean(row["study_locked_at"]) || studySide != null,
    source: "cron_30s",
    kalshi_snapshot_at: flow.snapped_at,
    kalshi_snapshot_source: "btc_kalshi_odds_snapshots",
  };

  const { error } = await supabaseAdmin.from("btc_window_snapshots").insert(insert);
  if (error) {
    return { ok: false, captured: false, ticker: flow.ticker, secondsToClose: stc, error: error.message };
  }

  return { ok: true, captured: true, ticker: flow.ticker, secondsToClose: stc };
}
