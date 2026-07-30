// Server-only helpers for snapshotting + settling BTC model predictions.
// Filename .server.ts blocks any client-side import.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchKalshiSettlement } from "@/lib/kalshiSettle";


const COINBASE = "https://api.exchange.coinbase.com";

export interface SnapshotInput {
  ticker: string;
  eventTicker: string | null;
  strike: number;
  side: "YES" | "NO";
  modelProb: number;
  marketYesPrice: number;
  edgePts: number;
  spot: number;
  closeTime: string;
  secondsToClose: number;
  sigmaMinEffective?: number;
  theoryYesProb?: number;
  anchorZ?: number;
  liveSide?: "YES" | "NO";
  chartVerdict?: "YES" | "NO" | "neutral";
  chartStrength?: number;
  taScore?: number;
  taReasons?: string[];
  taVwapDistPct?: number | null;
  taTrendAlignScore?: number;
  taRsi1m?: number | null;
  taRsi5m?: number | null;
  taMacd5mHist?: number | null;
  taBb5mPctB?: number | null;
  taVwapRejUp?: boolean;
  taVwapRejDown?: boolean;
  taEngineVersion?: string;
  // Phase 1: probability decomposition. Physics = diffusion+drift only.
  // Independent = physics + options + micro, but no Kalshi market blend and
  // no calibration. Both stored for the ablation report; gates ignore them.
  physicsProb?: number;
  independentProb?: number;
  // Phase 1A: jump-detection feature snapshot. Populated when the client
  // supplies a 1s spot buffer; otherwise null. Read-only; not gated on yet.
  jumpFeatures?: unknown;
  // Original model pick (raw p >= 0.5) frozen at first snapshot. Never
  // overwritten by Study/Fight. This is the "Model Pick" column in the UI.
  modelSidePreStudy?: "YES" | "NO";
  // Post-Study lock (final side chosen by the Fight Window at T+420s).
  // Written on every snapshot >= T+420s so the latest override sticks.
  studyLockedSide?: "YES" | "NO" | null;
  studyLockConfidence?: number | null;
  studyLockSource?: "trendline_chip" | "server_420" | "manual_correction" | null;
  studyLockSecondsToClose?: number | null;
  studyLockedAt?: string | null;
  // Phase 2 — shadow EV study enrichment.
  regimeTag?: string | null;
  calibrationBucket?: string | null;
  targetOffsetSeconds?: number | null;
  priceCeiling?: number | null;
  minEdgeThreshold?: number | null;
  minEvThreshold?: number | null;
  minConfThreshold?: number | null;
  sideConf?: number | null;
}


export function timeBucketOf(secondsToClose: number): string {
  if (secondsToClose <= 30) return "30s";
  if (secondsToClose <= 60) return "1m";
  if (secondsToClose <= 120) return "2m";
  if (secondsToClose <= 300) return "5m";
  if (secondsToClose <= 600) return "10m";
  return "13m+";
}

async function priceAt(unixSec: number): Promise<number | null> {
  const start = new Date((unixSec - 60) * 1000).toISOString();
  const end = new Date((unixSec + 120) * 1000).toISOString();
  try {
    const res = await fetch(
      `${COINBASE}/products/BTC-USD/candles?granularity=60&start=${start}&end=${end}`,
      { headers: { Accept: "application/json", "User-Agent": "edgegraph/1.0" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as number[][];
    if (!rows.length) return null;
    let best = rows[0];
    let bestDiff = Math.abs(rows[0][0] - unixSec);
    for (const r of rows) {
      const d = Math.abs(r[0] - unixSec);
      if (d < bestDiff) { bestDiff = d; best = r; }
    }
    return Number(best[4]);
  } catch {
    return null;
  }
}

export async function snapshotPrediction(input: SnapshotInput): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("id, snapshot_seconds_to_close, outcome, side, live_side, flip_count, study_locked_side")
      .eq("ticker", input.ticker)
      .maybeSingle();

    if (!existing) {
      // Early-row policy: within the first ~3 min of a 15-min window
      // (secondsToClose >= 720), create the row immediately so users see it
      // in the log ASAP — Model Pick and Study Pick columns fill in later at
      // their own natural times (T=0 model, T+420s study). Outside that
      // early window, keep the |edge| < 1 noise filter so near-certain
      // markets don't pollute the hit-rate denominator.
      const isEarlyInWindow = input.secondsToClose >= 720;
      if (!isEarlyInWindow && Math.abs(input.edgePts) < 1) return;
      // First snapshot: store the model's pick (side) — this is LOCKED for the
      // life of the market, even if model prob drifts across 50% later.
      await supabaseAdmin.from("btc_model_predictions").insert({
        ticker: input.ticker,
        event_ticker: input.eventTicker,
        strike: input.strike,
        side: input.side,
        model_prob: input.modelProb,
        market_yes_price: input.marketYesPrice,
        edge_pts: input.edgePts,
        spot_at_snapshot: input.spot,
        close_time: input.closeTime,
        snapshot_seconds_to_close: input.secondsToClose,
        sigma_at_snapshot: input.sigmaMinEffective ?? null,
        theory_yes_prob: input.theoryYesProb ?? null,
        anchor_z: input.anchorZ ?? null,
        live_side: input.liveSide ?? input.side,
        chart_verdict: input.chartVerdict ?? null,
        chart_strength: input.chartStrength ?? null,
        ta_score: input.taScore ?? null,
        ta_reasons: (input.taReasons ?? null) as never,
        ta_vwap_dist_pct: input.taVwapDistPct ?? null,
        ta_trend_alignment_score: input.taTrendAlignScore ?? null,
        ta_rsi_1m: input.taRsi1m ?? null,
        ta_rsi_5m: input.taRsi5m ?? null,
        ta_macd_5m_hist: input.taMacd5mHist ?? null,
        ta_bb_5m_pctb: input.taBb5mPctB ?? null,
        ta_vwap_rej_up: input.taVwapRejUp ?? false,
        ta_vwap_rej_down: input.taVwapRejDown ?? false,
        ta_engine_version: input.taEngineVersion ?? null,
        time_bucket: timeBucketOf(input.secondsToClose),
        physics_prob: input.physicsProb ?? null,
        independent_prob: input.independentProb ?? null,
        jump_features: (input.jumpFeatures ?? null) as never,
        model_side_pre_study: input.modelSidePreStudy ?? input.side,
        study_locked_side: input.studyLockedSide ?? null,
        study_lock_confidence: input.studyLockConfidence ?? null,
        study_lock_source: input.studyLockSource ?? null,
        study_lock_seconds_to_close: input.studyLockSecondsToClose ?? null,
        study_locked_at: input.studyLockedAt ?? null,
      } as never);

      return;
    }
    if (existing.outcome) return;
    if (input.secondsToClose < (existing.snapshot_seconds_to_close ?? 1e9)) {
      // IMPORTANT: do NOT touch `side` — original pick is locked. Refresh only
      // the transient telemetry so exit signals can see live drift.
      // Live-side flip tracking: increment counter if the incoming liveSide
      // differs from what we last stored.
      const prevLive = (existing.live_side as string | null) ?? (existing.side as string);
      const nextLive = input.liveSide ?? prevLive;
      const flipped = nextLive !== prevLive;
      const shouldWriteStudyLock = Boolean(input.studyLockedSide) && !existing.study_locked_side;
      await supabaseAdmin.from("btc_model_predictions").update({
        model_prob: input.modelProb,
        market_yes_price: input.marketYesPrice,
        edge_pts: input.edgePts,
        spot_at_snapshot: input.spot,
        snapshot_seconds_to_close: input.secondsToClose,
        sigma_at_snapshot: input.sigmaMinEffective ?? null,
        theory_yes_prob: input.theoryYesProb ?? null,
        anchor_z: input.anchorZ ?? null,
        live_side: nextLive,
        chart_verdict: input.chartVerdict ?? null,
        chart_strength: input.chartStrength ?? null,
        ta_score: input.taScore ?? null,
        ta_reasons: (input.taReasons ?? null) as never,
        ta_vwap_dist_pct: input.taVwapDistPct ?? null,
        ta_trend_alignment_score: input.taTrendAlignScore ?? null,
        ta_rsi_1m: input.taRsi1m ?? null,
        ta_rsi_5m: input.taRsi5m ?? null,
        ta_macd_5m_hist: input.taMacd5mHist ?? null,
        ta_bb_5m_pctb: input.taBb5mPctB ?? null,
        ta_vwap_rej_up: input.taVwapRejUp ?? false,
        ta_vwap_rej_down: input.taVwapRejDown ?? false,
        ta_engine_version: input.taEngineVersion ?? null,
        time_bucket: timeBucketOf(input.secondsToClose),
        physics_prob: input.physicsProb ?? null,
        independent_prob: input.independentProb ?? null,
        jump_features: (input.jumpFeatures ?? null) as never,
        ...(shouldWriteStudyLock ? {
          study_locked_side: input.studyLockedSide,
          study_lock_confidence: input.studyLockConfidence ?? null,
          study_lock_source: input.studyLockSource ?? null,
          study_lock_seconds_to_close: input.studyLockSecondsToClose ?? null,
          study_locked_at: input.studyLockedAt ?? new Date().toISOString(),
        } : {}),



        ...(flipped ? {
          flip_count: Number(existing.flip_count ?? 0) + 1,
          flipped_at: new Date().toISOString(),
        } : {}),
      } as never).eq("id", existing.id);
    }
  } catch (e) {
    console.warn("snapshotPrediction failed:", e);
  }
  // Shadow EV log — fire-and-forget, never blocks the snapshot write.
  void (async () => {
    try {
      const { logEvDecision } = await import("./evDecisionLog.server");
      await logEvDecision(input);
    } catch { /* swallowed inside logEvDecision */ }
  })();
}

// Read the locked sides for a batch of tickers (one round-trip).
export async function getLockedSides(tickers: string[]): Promise<Map<string, "YES" | "NO">> {
  const out = new Map<string, "YES" | "NO">();
  if (!tickers.length) return out;
  try {
    const { data } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, side")
      .in("ticker", tickers);
    for (const r of data ?? []) out.set(r.ticker as string, r.side as "YES" | "NO");
  } catch (e) {
    console.warn("getLockedSides failed:", e);
  }
  return out;
}

export async function settleDuePredictions(): Promise<{ settled: number }> {
  try {
    const { data: due } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("id, ticker, strike, side, study_locked_side, close_time")
      .is("outcome", null)
      .lt("close_time", new Date(Date.now() - 30_000).toISOString())
      .order("close_time", { ascending: true })
      .limit(200);

    if (!due?.length) return { settled: 0 };

    // Kalshi's official settlement (result + expiration_value) is the ONLY
    // source of truth. Coinbase spot at close_time can differ from Kalshi's
    // expiration_value by a few dollars and flip the outcome near-strike
    // (mislabels our model as wrong when it was right). If Kalshi hasn't
    // finalized yet, leave the row pending — the cron re-runs each minute.
    const results = await Promise.all(due.map(async (r) => {
      const kalshi = await fetchKalshiSettlement(r.ticker as string);
      if (kalshi?.finalized && kalshi.result) {
        return { r, settle: kalshi.expirationValue, outcome: kalshi.result.toUpperCase() as "YES" | "NO" };
      }
      return { r, settle: null as number | null, outcome: null as "YES" | "NO" | null };
    }));

    let settled = 0;
    await Promise.all(results.map(async ({ r, settle, outcome }) => {
      if (!outcome) return;
      const finalPick = ((r as { study_locked_side?: string | null }).study_locked_side as "YES" | "NO" | null) ?? (r.side as "YES" | "NO");
      const wasCorrect = outcome === finalPick;
      await supabaseAdmin
        .from("btc_model_predictions")
        .update({
          settle_price: settle,
          outcome,
          was_correct: wasCorrect,
          settled_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      settled++;
      // Shadow EV backfill — fire-and-forget.
      void (async () => {
        try {
          const { backfillEvOutcome } = await import("./evDecisionLog.server");
          await backfillEvOutcome(r.ticker as string, outcome);
        } catch { /* swallowed */ }
      })();
    }));

    return { settled };

  } catch (e) {
    console.warn("settleDuePredictions failed:", e);
    return { settled: 0 };
  }
}


export interface PredictionStatsResult {
  total: number;
  settled: number;
  correct: number;
  winRate: number;
  byWindow: {
    last12h: { settled: number; correct: number; winRate: number };
    last24h: { settled: number; correct: number; winRate: number };
    last7d: { settled: number; correct: number; winRate: number };
  };
  recent: Array<{
    ticker: string;
    side: "YES" | "NO";
    strike: number;
    modelProb: number;
    marketYesPrice: number;
    edgePts: number;
    outcome: "YES" | "NO" | null;
    wasCorrect: boolean | null;
    settlePrice: number | null;
    closeTime: string;
    settledAt: string | null;
    liveSide: "YES" | "NO" | null;
    flipCount: number;
    chartVerdict: "YES" | "NO" | "neutral" | null;
    chartStrength: number | null;
    taScore: number | null;
    taReasons: string[];
    taVwapDistPct: number | null;
    taTrendAlignScore: number | null;
    taRsi1m: number | null;
    taRsi5m: number | null;
    taMacd5mHist: number | null;
    taBb5mPctB: number | null;
    taVwapRejUp: boolean;
    taVwapRejDown: boolean;
    taEngineVersion: string | null;
    modelSidePreStudy: "YES" | "NO" | null;
    studyLockedSide: "YES" | "NO" | null;
    /** Study Pick graded on its own locked side (null when no valid lock). */
    studyWasCorrect: boolean | null;
    studyLockConfidence: number | null;
    studyLockSource: string | null;
    studyLockSecondsToClose: number | null;
    studyLockedAt: string | null;
    studyLockKalshiPriceCents: number | null;
    cvvWouldLockSide: "YES" | "NO" | null;
    cvvWouldLockConf: number | null;
    skipGuardReason: string | null;
    /** Always-recorded snapshot of what the study saw at the 7-minute mark. */
    studyT7Side: "YES" | "NO" | null;
    studyT7Conf: number | null;
    studyT7SecondsToClose: number | null;
    studyT7Source: string | null;
    /** T+7 snapshot graded against settlement (null until settled). */
    studyT7WasCorrect: boolean | null;

  }>;
}

// Fresh-start cutoff: model accuracy panel (Tracked / Correct / Win rate 7d /
// Win rate 24h / Awaiting settle) ignores anything with close_time before
// this instant. Set to today 00:00 UTC. Change to bring history back.
const STATS_RESET_ISO = "2026-07-09T00:00:00Z";

export async function computePredictionStats(): Promise<PredictionStatsResult> {
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since12h = new Date(Date.now() - 12 * 3600_000).toISOString();
  const cutoff = since7d > STATS_RESET_ISO ? since7d : STATS_RESET_ISO;

  const { data: rows } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, side, strike, model_prob, market_yes_price, edge_pts, outcome, was_correct, settle_price, close_time, settled_at, live_side, flip_count, chart_verdict, chart_strength, ta_score, ta_reasons, ta_vwap_dist_pct, ta_trend_alignment_score, ta_rsi_1m, ta_rsi_5m, ta_macd_5m_hist, ta_bb_5m_pctb, ta_vwap_rej_up, ta_vwap_rej_down, ta_engine_version, model_side_pre_study, study_locked_side, study_lock_confidence, study_lock_source, study_lock_seconds_to_close, study_locked_at, study_lock_kalshi_price_cents, cvv_would_lock_side, cvv_would_lock_conf, skip_guard_reason, study_t7_side, study_t7_conf, study_t7_seconds_to_close, study_t7_source")
    .gte("close_time", cutoff)
    .order("close_time", { ascending: false })
    .limit(500);

    const all = rows ?? [];
    // A Study Pick only counts when the trendline study actually locked at or
    // above the documented conviction threshold. Sub-threshold rows (older
    // backfills wrote 3%–60% "locks") are NOT study picks.
    const MIN_STUDY_LOCK_CONF = 75;
    const lockOf = (r: (typeof all)[number]): "YES" | "NO" | null => {
      const s = (r as { study_locked_side?: string | null }).study_locked_side as "YES" | "NO" | null;
      if (s !== "YES" && s !== "NO") return null;
      const c = (r as { study_lock_confidence?: number | string | null }).study_lock_confidence;
      if (c != null && Number(c) < MIN_STUDY_LOCK_CONF) return null;
      return s;
    };
    // T+7 snapshot: what the study actually saw at the 7-minute mark. Always
    // present going forward, so the Study Pick column is never blank.
    const t7Of = (r: (typeof all)[number]): "YES" | "NO" | null => {
      const s = (r as { study_t7_side?: string | null }).study_t7_side as "YES" | "NO" | null;
      return s === "YES" || s === "NO" ? s : null;
    };
    const t7ConfOf = (r: (typeof all)[number]): number | null => {
      const c = (r as { study_t7_conf?: number | string | null }).study_t7_conf;
      return c != null ? Number(c) : null;
    };
    const pickSide = (r: (typeof all)[number]): "YES" | "NO" =>
      lockOf(r) ?? t7Of(r) ?? (r.side as "YES" | "NO");

    const rowCorrect = (r: (typeof all)[number]): boolean | null =>
      r.outcome ? ((r.outcome as "YES" | "NO") === pickSide(r)) : null;
    const settledAll = all.filter(r => r.outcome);
    const correctAll = settledAll.filter(r => rowCorrect(r) === true).length;
  const in24 = settledAll.filter(r => (r.close_time as string) >= since24h);
    const correct24 = in24.filter(r => rowCorrect(r) === true).length;
  const in12 = settledAll.filter(r => (r.close_time as string) >= since12h);
    const correct12 = in12.filter(r => rowCorrect(r) === true).length;

  return {
    total: all.length,
    settled: settledAll.length,
    correct: correctAll,
    winRate: settledAll.length ? correctAll / settledAll.length : 0,
    byWindow: {
      last12h: {
        settled: in12.length,
        correct: correct12,
        winRate: in12.length ? correct12 / in12.length : 0,
      },
      last24h: {
        settled: in24.length,
        correct: correct24,
        winRate: in24.length ? correct24 / in24.length : 0,
      },
      last7d: {
        settled: settledAll.length,
        correct: correctAll,
        winRate: settledAll.length ? correctAll / settledAll.length : 0,
      },
    },
    recent: all.map(r => ({
      ticker: r.ticker as string,
      side: pickSide(r),
      strike: Number(r.strike),
      modelProb: Number(r.model_prob),
      marketYesPrice: Number(r.market_yes_price),
      edgePts: Number(r.edge_pts),
      outcome: (r.outcome as "YES" | "NO" | null) ?? null,
      wasCorrect: rowCorrect(r),
      settlePrice: r.settle_price != null ? Number(r.settle_price) : null,
      closeTime: r.close_time as string,
      settledAt: (r.settled_at as string | null) ?? null,
      liveSide: (r.live_side as "YES" | "NO" | null) ?? null,
      flipCount: Number(r.flip_count ?? 0),
      chartVerdict: (r.chart_verdict as "YES" | "NO" | "neutral" | null) ?? null,
      chartStrength: r.chart_strength != null ? Number(r.chart_strength) : null,
      taScore: r.ta_score != null ? Number(r.ta_score) : null,
      taReasons: Array.isArray(r.ta_reasons) ? (r.ta_reasons as unknown[]).map(String) : [],
      taVwapDistPct: r.ta_vwap_dist_pct != null ? Number(r.ta_vwap_dist_pct) : null,
      taTrendAlignScore: r.ta_trend_alignment_score != null ? Number(r.ta_trend_alignment_score) : null,
      taRsi1m: r.ta_rsi_1m != null ? Number(r.ta_rsi_1m) : null,
      taRsi5m: r.ta_rsi_5m != null ? Number(r.ta_rsi_5m) : null,
      taMacd5mHist: r.ta_macd_5m_hist != null ? Number(r.ta_macd_5m_hist) : null,
      taBb5mPctB: r.ta_bb_5m_pctb != null ? Number(r.ta_bb_5m_pctb) : null,
      taVwapRejUp: Boolean(r.ta_vwap_rej_up),
      taVwapRejDown: Boolean(r.ta_vwap_rej_down),
      taEngineVersion: (r.ta_engine_version as string | null) ?? null,
      modelSidePreStudy: ((r as { model_side_pre_study?: string | null }).model_side_pre_study as "YES" | "NO" | null) ?? (r.side as "YES" | "NO" | null) ?? null,
      studyLockedSide: lockOf(r),
      studyWasCorrect: lockOf(r) && r.outcome ? (r.outcome as "YES" | "NO") === lockOf(r) : null,
      studyLockConfidence: lockOf(r) != null && (r as { study_lock_confidence?: number | string | null }).study_lock_confidence != null
        ? Number((r as { study_lock_confidence?: number | string | null }).study_lock_confidence)
        : null,
      studyLockSource: lockOf(r) ? (((r as { study_lock_source?: string | null }).study_lock_source) ?? null) : null,
      studyLockSecondsToClose: lockOf(r) ? ((r as { study_lock_seconds_to_close?: number | null }).study_lock_seconds_to_close ?? null) : null,
      studyLockedAt: lockOf(r) ? (((r as { study_locked_at?: string | null }).study_locked_at) ?? null) : null,
      studyLockKalshiPriceCents: (r as { study_lock_kalshi_price_cents?: number | null }).study_lock_kalshi_price_cents != null ? Number((r as { study_lock_kalshi_price_cents?: number | null }).study_lock_kalshi_price_cents) : null,
      // When a sub-threshold "lock" exists, surface it as a would-lock instead
      // of dressing it up as a Study Pick.
      cvvWouldLockSide: ((r as { cvv_would_lock_side?: string | null }).cvv_would_lock_side as "YES" | "NO" | null)
        ?? (lockOf(r) ? null : (((r as { study_locked_side?: string | null }).study_locked_side as "YES" | "NO" | null) ?? null)),
      cvvWouldLockConf: (r as { cvv_would_lock_conf?: number | string | null }).cvv_would_lock_conf != null
        ? Number((r as { cvv_would_lock_conf?: number | string | null }).cvv_would_lock_conf)
        : (lockOf(r) ? null : ((r as { study_lock_confidence?: number | string | null }).study_lock_confidence != null
            ? Number((r as { study_lock_confidence?: number | string | null }).study_lock_confidence)
            : null)),
      skipGuardReason: ((r as { skip_guard_reason?: string | null }).skip_guard_reason)
        ?? (!lockOf(r) && (r as { study_locked_side?: string | null }).study_locked_side ? "below_lock_threshold" : null),
      studyT7Side: t7Of(r),
      studyT7Conf: t7ConfOf(r),
      studyT7SecondsToClose: (r as { study_t7_seconds_to_close?: number | null }).study_t7_seconds_to_close ?? null,
      studyT7Source: ((r as { study_t7_source?: string | null }).study_t7_source) ?? null,
      studyT7WasCorrect: t7Of(r) && r.outcome ? (r.outcome as "YES" | "NO") === t7Of(r) : null,
    })),

  };
}
