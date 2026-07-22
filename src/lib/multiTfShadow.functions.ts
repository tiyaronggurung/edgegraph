// Multi-timeframe shadow decision evaluator.
// PURE LOGGING — does not touch PRED, Green Hours, paper, or live auto-trade.
// Called by cron every minute. For each active BTC 15m window, computes:
//   - Multi-TF context (VWAP, structure, 24h/weekly/monthly range, S/R)
//   - Decision state based on time-to-close
//   - Proposed side + conflict reasons
//   - Signal stability (side flips across snapshots)
// Writes one row per active-market per call into btc_multi_tf_decision_log.

import { createServerFn } from "@tanstack/react-start";
import { computeBtcMarkets, type BtcCandle } from "./cryptoBtc.functions";
import {
  detectLevels, rangePercentile, biasFromCandles, structureBias, atr, vwap,
} from "./ta/levels";
import { computeTaScore } from "./ta/taEngine";

const COINBASE = "https://api.exchange.coinbase.com";

async function fetchCandles(granularitySec: number, count: number): Promise<BtcCandle[]> {
  const end = new Date();
  const start = new Date(end.getTime() - granularitySec * 1000 * count);
  const url = `${COINBASE}/products/BTC-USD/candles?granularity=${granularitySec}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const arr = (await r.json()) as Array<[number, number, number, number, number, number]>;
  return arr.map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

function decisionState(secondsToClose: number): string {
  if (secondsToClose > 5 * 60) return "PENDING_EARLY";
  if (secondsToClose > 2 * 60) return "PENDING_VERIFY";
  if (secondsToClose > 30) return "ELIGIBLE";
  if (secondsToClose > 0) return "LATE_RISK";
  return "SETTLEMENT_VERIFY";
}

function proposedSide(modelProb: number): "UP" | "DOWN" | "NEUTRAL" {
  if (modelProb >= 0.60) return "UP";
  if (modelProb <= 0.40) return "DOWN";
  return "NEUTRAL";
}

async function priorSnapshots(supabaseAdmin: any, ticker: string) {
  const { data } = await supabaseAdmin
    .from("btc_multi_tf_decision_log")
    .select("proposed_side, side_flip_count, seconds_to_close")
    .eq("window_ticker", ticker)
    .order("snapshot_at", { ascending: false })
    .limit(20);
  return (data ?? []) as Array<{ proposed_side: string | null; side_flip_count: number | null; seconds_to_close: number }>;
}

function sideAt(prior: Array<{ proposed_side: string | null; seconds_to_close: number }>, targetSec: number, tolSec = 45): string | null {
  const hit = prior.find((p) => Math.abs(p.seconds_to_close - targetSec) <= tolSec);
  return hit?.proposed_side ?? null;
}

export const runMultiTfShadow = createServerFn({ method: "POST" }).handler(async () => {
  const [markets, candles5m300, candles1h, candlesDaily] = await Promise.all([
    computeBtcMarkets(),
    fetchCandles(300, 300),   // 5m × 300 = 25h
    fetchCandles(3600, 168),  // 1h × 168 = 1 week
    fetchCandles(86400, 30),  // 1d × 30 = 1 month
  ]);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const spot = markets.spot;
  const now = Date.now();

  // Multi-TF context (window-independent)
  const vw = vwap(candles5m300);
  const struct5m = structureBias(candles5m300, 12);
  const struct1m = biasFromCandles(markets.candles.slice(-30));
  const rng24h = rangePercentile(candles5m300, spot);
  const rngWeek = rangePercentile(candles1h, spot);
  const rngMonth = rangePercentile(candlesDaily, spot);
  const bias1h = biasFromCandles(candles1h.slice(-24));
  const biasW = biasFromCandles(candles1h);
  const biasM = biasFromCandles(candlesDaily);
  const atr5 = atr(candles5m300, 14);
  const levels = detectLevels(candles5m300, spot);

  const rows: any[] = [];

  for (const m of markets.markets) {
    if (!m.closeTime) continue;
    const closeAt = new Date(m.closeTime).getTime();
    const secondsToClose = Math.round((closeAt - now) / 1000);
    if (secondsToClose < -30 || secondsToClose > 15 * 60 + 60) continue; // active-ish only

    const state = decisionState(secondsToClose);
    const modelProb = m.modelYesProb;
    const side = proposedSide(modelProb);
    const sideConf = Math.abs(modelProb - 0.5) * 2;
    const strikeDistUsd = spot - m.strike;
    const strikeDistAtr = atr5 ? strikeDistUsd / atr5 : null;

    // TA score (uses same 1m real candles pipeline)
    let taScore = 0; let taReasons: any = null;
    try {
      const ta = computeTaScore(markets.candles, candles5m300);
      taScore = ta.score;
      taReasons = ta.reasons;
    } catch {}

    // Load prior snapshots for stability + checkpoint tracking
    const prior = await priorSnapshots(supabaseAdmin, m.ticker);
    const lastSide = prior[0]?.proposed_side ?? null;
    const flipsBase = prior[0]?.side_flip_count ?? 0;
    const flipCount = lastSide && side !== lastSide && lastSide !== "NEUTRAL" && side !== "NEUTRAL"
      ? flipsBase + 1 : flipsBase;

    const sideT5 = sideAt(prior, 5 * 60);
    const sideT3 = sideAt(prior, 3 * 60);
    const sideT2 = sideAt(prior, 2 * 60);
    const sideT1 = sideAt(prior, 60);
    const sideT30 = sideAt(prior, 30, 20);

    // Conflict rules
    let conflict: string | null = null;
    const supp = levels.nearestSupport;
    const res = levels.nearestResistance;
    if (side === "DOWN" && supp && Math.abs(supp.price - spot) <= 150 && supp.touches >= 3 && supp.status === "rejection") {
      conflict = "SKIP_SUPPORT_CONFLICT";
    } else if (side === "UP" && res && Math.abs(res.price - spot) <= 150 && res.touches >= 3 && res.status === "rejection") {
      conflict = "SKIP_RESISTANCE_CONFLICT";
    }

    // Multi-TF alignment for the shadow "would-fire" flag
    const vwapAligned = vw ? ((side === "UP" && spot >= vw) || (side === "DOWN" && spot <= vw)) : false;
    const structAligned = (side === "UP" && (struct5m === "bull" || struct1m === "bull"))
      || (side === "DOWN" && (struct5m === "bear" || struct1m === "bear"));
    const rangeOk = side === "UP" ? (rng24h ?? 50) < 92 : (rng24h ?? 50) > 8;

    const eligible = state === "ELIGIBLE"
      && side !== "NEUTRAL"
      && sideConf >= 0.70
      && !conflict
      && vwapAligned
      && structAligned
      && rangeOk
      && (m.yesAsk >= 50 && m.yesAsk <= 78);

    rows.push({
      window_ticker: m.ticker,
      window_open_at: m.openTime,
      window_close_at: m.closeTime,
      seconds_to_close: secondsToClose,
      decision_state: state,
      proposed_side: side,
      side_confidence: sideConf,
      model_prob: modelProb,
      ta_score: taScore,
      ta_reasons: taReasons,
      spot_price: spot,
      strike_price: m.strike,
      strike_distance_usd: strikeDistUsd,
      strike_distance_atr: strikeDistAtr,
      atr_5m: atr5,
      kalshi_ask: side === "UP" ? m.yesAsk : m.noAsk,
      kalshi_bid: side === "UP" ? m.yesBid : m.noBid,
      expected_value_after_fees: null,
      side_flip_count: flipCount,
      side_at_t_minus_5m: sideT5,
      side_at_t_minus_3m: sideT3,
      side_at_t_minus_2m: sideT2,
      side_at_t_minus_1m: sideT1,
      side_at_t_minus_30s: sideT30,
      above_session_vwap: vw ? spot >= vw : null,
      structure_1m: struct1m,
      structure_5m: struct5m,
      range_pct_24h: rng24h,
      range_pct_weekly: rngWeek,
      range_pct_monthly: rngMonth,
      bias_1h: bias1h,
      bias_weekly: biasW,
      bias_monthly: biasM,
      nearest_support_usd: supp?.price ?? null,
      nearest_support_distance: supp ? spot - supp.price : null,
      nearest_support_touches: supp?.touches ?? null,
      nearest_support_status: supp?.status ?? null,
      nearest_resistance_usd: res?.price ?? null,
      nearest_resistance_distance: res ? res.price - spot : null,
      nearest_resistance_touches: res?.touches ?? null,
      nearest_resistance_status: res?.status ?? null,
      conflict_reason: conflict,
      eligible_to_fire: eligible,
      ta_only_side: side,
      multi_tf_side: conflict ? "SKIP" : side,
      engine_version: "multi-tf-v1",
    });
  }

  if (rows.length === 0) return { inserted: 0 };

  const { error } = await supabaseAdmin.from("btc_multi_tf_decision_log").insert(rows);
  if (error) {
    console.warn("[multiTfShadow] insert failed:", error.message);
    return { inserted: 0, error: error.message };
  }
  return { inserted: rows.length };
});
