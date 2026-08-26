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
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";

/** Only capture inside the window that matters for entry decisions. */
export const CAPTURE_MAX_SECONDS_TO_CLOSE = 8 * 60; // T-8m
export const CAPTURE_MIN_SECONDS_TO_CLOSE = 0;

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
  const [flowRes, levelsRes] = await Promise.allSettled([
    getKalshiImpliedSpot(),
    getBtcLevels({ limit: 120 }),
  ]);

  const flow = flowRes.status === "fulfilled" ? flowRes.value : null;
  const levels = levelsRes.status === "fulfilled" ? levelsRes.value : null;

  if (!flow?.ok || !flow.ticker || flow.strike == null || flow.secondsToClose == null) {
    return {
      ok: false,
      captured: false,
      ticker: flow?.ticker ?? null,
      secondsToClose: flow?.secondsToClose ?? null,
      error: flow?.error ?? "kalshi unavailable",
    };
  }

  const stc = flow.secondsToClose;
  if (stc > CAPTURE_MAX_SECONDS_TO_CLOSE || stc < CAPTURE_MIN_SECONDS_TO_CLOSE) {
    return { ok: true, captured: false, ticker: flow.ticker, secondsToClose: stc, reason: "outside T-8m..close" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

  const spot = levels?.ok ? levels.spot : null;
  const cents = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));
  const yesAskC = cents(flow.yesAsk);
  const yesBidC = cents(flow.yesBid);

  const insert = {
    ticker: flow.ticker,
    close_time: new Date(Date.now() + stc * 1000).toISOString(),
    seconds_to_close: Math.round(stc),
    strike_usd: flow.strike,
    spot_usd: spot,
    cushion_usd: spot != null ? Number((spot - flow.strike).toFixed(2)) : null,
    yes_bid_cents: yesBidC,
    yes_ask_cents: yesAskC,
    // Kalshi's NO book is the complement of the YES book.
    no_bid_cents: yesAskC == null ? null : 100 - yesAskC,
    no_ask_cents: yesBidC == null ? null : 100 - yesBidC,
    volume: flow.volume,
    open_interest: flow.openInterest,
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
  };

  const { error } = await supabaseAdmin.from("btc_window_snapshots").insert(insert);
  if (error) {
    return { ok: false, captured: false, ticker: flow.ticker, secondsToClose: stc, error: error.message };
  }

  return { ok: true, captured: true, ticker: flow.ticker, secondsToClose: stc };
}
