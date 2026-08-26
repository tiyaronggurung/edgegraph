// Server-only: replay of the consensus verdict for SETTLED BTC 15m windows.
//
// Powers GET /api/public/btc/consensus/history?from=&to=
//
// Read-only. Places no orders, touches no trading path, and does not reuse the
// live micro-cache. For each settled window we reconstruct the decision as it
// stood at a chosen decision point (default: the snapshot closest to T-240s,
// inside the 120..300s band) using only data recorded at or before that point:
//
//   * study lock  — btc_model_predictions.study_locked_side / confidence (T7 lock)
//   * model pick  — model_side_pre_study / side + model_prob
//   * price       — btc_kalshi_odds_snapshots (yes ask, composite spot)
//   * trendline   — btc_trendline_shadow (upper/lower channel at that second)
//
// Trendline levels are the recorded shadow channel, not a re-derivation, so the
// replay carries no look-ahead. Windows with no trendline row keep
// trendlineSource = null and the trendline veto is reported as unavailable
// rather than silently passing.

import { CONSENSUS_RULES, type Side, type Verdict } from "@/lib/btcConsensus.server";

export interface HistoryWindow {
  ticker: string;
  closeTime: string;
  utcHour: number;
  strike: number;
  decisionSecondsToClose: number | null;

  spot: number | null;
  cushionUsd: number | null;
  askCents: number | null;

  studySide: Side | null;
  studyConfidence: number | null;
  studyLockedAt: string | null;
  skipReason: string | null;

  modelSide: Side | null;
  modelConfidence: number | null;

  trendline: {
    source: "shadow_snapshot" | null;
    buy: number | null;
    mid: number | null;
    sell: number | null;
    position: string;
    side: Side | null;
    distToMidUsd: number | null;
  };

  agreement: string;
  verdict: Verdict;
  side: Side | null;
  reasons: string[];

  outcome: Side | null;
  correct: boolean | null;
}

export interface HistoryResponse {
  ok: boolean;
  from: string;
  to: string;
  decisionSecondsToClose: number;
  rules: typeof CONSENSUS_RULES;
  count: number;
  summary: {
    settledWindows: number;
    allow: number;
    caution: number;
    skip: number;
    allowWins: number;
    allowWinRate: number | null;
    cautionWinRate: number | null;
    trendlineCoverage: number;
  };
  windows: HistoryWindow[];
  error: string | null;
}

const asSide = (v: unknown): Side | null => (v === "YES" || v === "NO" ? v : null);

const MAX_RANGE_DAYS = 45;
const MAX_WINDOWS = 2000;

export async function getBtcConsensusHistory(opts: {
  from?: string | null;
  to?: string | null;
  decisionSeconds?: number | null;
}): Promise<HistoryResponse> {
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from ? new Date(opts.from) : new Date(to.getTime() - 7 * 864e5);
  const decisionSeconds = Math.min(
    CONSENSUS_RULES.maxSecondsToClose,
    Math.max(CONSENSUS_RULES.minSecondsToClose, Number(opts.decisionSeconds ?? 240)),
  );

  const base: HistoryResponse = {
    ok: false,
    from: from.toISOString(),
    to: to.toISOString(),
    decisionSecondsToClose: decisionSeconds,
    rules: CONSENSUS_RULES,
    count: 0,
    summary: {
      settledWindows: 0, allow: 0, caution: 0, skip: 0,
      allowWins: 0, allowWinRate: null, cautionWinRate: null, trendlineCoverage: 0,
    },
    windows: [],
    error: null,
  };

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return { ...base, error: "invalid from/to range" };
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 864e5) {
    return { ...base, error: `range exceeds ${MAX_RANGE_DAYS} days` };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: predRows, error: predErr } = await supabaseAdmin
    .from("btc_model_predictions")
    .select(
      "ticker, close_time, strike, outcome, side, model_prob, model_side_pre_study, study_locked_side, study_lock_confidence, study_locked_at, skip_guard_reason",
    )
    .gte("close_time", from.toISOString())
    .lte("close_time", to.toISOString())
    .not("outcome", "is", null)
    .order("close_time", { ascending: true })
    .limit(MAX_WINDOWS);

  if (predErr) return { ...base, error: predErr.message };

  // Collapse to one row per ticker (predictions are written repeatedly per window).
  const byTicker = new Map<string, Record<string, unknown>>();
  for (const r of (predRows ?? []) as Record<string, unknown>[]) {
    const t = String(r["ticker"]);
    const prev = byTicker.get(t);
    // Prefer the row that actually carries the T7 study lock.
    if (!prev || (!prev["study_locked_side"] && r["study_locked_side"])) byTicker.set(t, r);
  }
  const tickers = [...byTicker.keys()];
  if (tickers.length === 0) return { ...base, ok: true };

  const [snapRes, trendRes] = await Promise.all([
    supabaseAdmin
      .from("btc_kalshi_odds_snapshots")
      .select("ticker, seconds_to_close, kalshi_yes_ask, kalshi_yes_mid, spot_composite, strike")
      .in("ticker", tickers)
      .gte("seconds_to_close", CONSENSUS_RULES.minSecondsToClose)
      .lte("seconds_to_close", CONSENSUS_RULES.maxSecondsToClose),
    supabaseAdmin
      .from("btc_trendline_shadow")
      .select("ticker, seconds_to_close, upper_price_now, lower_price_now, spot")
      .in("ticker", tickers)
      .gte("seconds_to_close", CONSENSUS_RULES.minSecondsToClose)
      .lte("seconds_to_close", CONSENSUS_RULES.maxSecondsToClose),
  ]);

  // Nearest-to-decision-point snapshot per ticker.
  const pickNearest = <T extends { ticker: string; seconds_to_close: number | null }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) {
      const s = r.seconds_to_close;
      if (s == null) continue;
      const cur = m.get(r.ticker);
      if (!cur || Math.abs(s - decisionSeconds) < Math.abs((cur.seconds_to_close ?? 1e9) - decisionSeconds)) {
        m.set(r.ticker, r);
      }
    }
    return m;
  };

  const snaps = pickNearest(((snapRes.data ?? []) as unknown[]) as { ticker: string; seconds_to_close: number | null; kalshi_yes_ask: number | null; kalshi_yes_mid: number | null; spot_composite: number | null; strike: number }[]);
  const trends = pickNearest(((trendRes.data ?? []) as unknown[]) as { ticker: string; seconds_to_close: number | null; upper_price_now: number | null; lower_price_now: number | null; spot: number }[]);

  const windows: HistoryWindow[] = [];

  for (const ticker of tickers) {
    const row = byTicker.get(ticker)!;
    const snap = snaps.get(ticker) ?? null;
    const tl = trends.get(ticker) ?? null;

    const strike = Number(row["strike"]);
    const closeTime = String(row["close_time"]);
    const outcome = asSide(row["outcome"]);
    const spot = snap?.spot_composite ?? tl?.spot ?? null;
    const cushionUsd = spot != null ? Number((spot - strike).toFixed(2)) : null;

    const askRaw = snap?.kalshi_yes_ask ?? snap?.kalshi_yes_mid ?? null;
    const askCents = askRaw == null ? null : Math.round(askRaw > 1 ? askRaw : askRaw * 100);

    const modelSide = asSide(row["model_side_pre_study"]) ?? asSide(row["side"]);
    const modelProb = row["model_prob"] == null ? null : Number(row["model_prob"]);
    const modelConf =
      modelProb == null || !Number.isFinite(modelProb) ? null : modelSide === "NO" ? 1 - modelProb : modelProb;

    const studySide = asSide(row["study_locked_side"]);
    const scRaw = row["study_lock_confidence"] == null ? null : Number(row["study_lock_confidence"]);
    const studyConf = scRaw == null || !Number.isFinite(scRaw) ? null : scRaw > 1 ? scRaw / 100 : scRaw;

    // --- trendline reconstruction ---
    const sell = tl?.upper_price_now ?? null;
    const buy = tl?.lower_price_now ?? null;
    const mid = sell != null && buy != null ? (sell + buy) / 2 : null;
    let position = "unknown";
    let trendSide: Side | null = null;
    let distToMidUsd: number | null = null;
    if (spot != null && sell != null && buy != null && mid != null) {
      distToMidUsd = Number((spot - mid).toFixed(2));
      position =
        spot > sell ? "above_sell" : spot < buy ? "below_buy" : spot >= mid ? "upper_half" : "lower_half";
      trendSide = position === "above_sell" || position === "upper_half" ? "YES" : "NO";
    }

    let agreement = "split";
    if (studySide && modelSide && trendSide && studySide === modelSide && modelSide === trendSide) agreement = "all_three";
    else if (studySide && trendSide && studySide === trendSide) agreement = "study_trendline";
    else if (modelSide && trendSide && modelSide === trendSide) agreement = "model_trendline";
    else if (studySide && modelSide && studySide === modelSide) agreement = "study_model";
    if (!studySide && !modelSide && !trendSide) agreement = "unknown";

    // --- same rule stack as the live verdict ---
    const reasons: string[] = [];
    let verdict: Verdict = "ALLOW";
    const skip = (r: string) => { reasons.push(r); verdict = "SKIP"; };
    const caution = (r: string) => { reasons.push(r); if (verdict !== "SKIP") verdict = "CAUTION"; };

    const pick = studySide;
    if (!pick) {
      skip(row["skip_guard_reason"] ? `no T7 study lock (${String(row["skip_guard_reason"])})` : "no T7 study lock");
    }
    if (snap == null) skip("no recorded price snapshot inside the decision band");
    if (studyConf != null && studyConf < CONSENSUS_RULES.minStudyConf) {
      skip(`study confidence ${(studyConf * 100).toFixed(0)}% below ${CONSENSUS_RULES.minStudyConf * 100}%`);
    }
    if (distToMidUsd == null) caution("no recorded trendline channel (MID veto unavailable)");
    else if (Math.abs(distToMidUsd) < CONSENSUS_RULES.minMidDistanceUsd) {
      skip(`|spot - MID| $${Math.abs(distToMidUsd).toFixed(0)} < $${CONSENSUS_RULES.minMidDistanceUsd}`);
    }
    if (cushionUsd == null) skip("no cushion");
    else if (Math.abs(cushionUsd) < CONSENSUS_RULES.minCushionUsd) {
      skip(`cushion $${Math.abs(cushionUsd).toFixed(0)} < $${CONSENSUS_RULES.minCushionUsd}`);
    }
    if (pick && trendSide && trendSide !== pick) skip(`trendline zone (${position}) contradicts study pick ${pick}`);
    if (pick && cushionUsd != null) {
      const cushionSide: Side = cushionUsd >= 0 ? "YES" : "NO";
      if (cushionSide !== pick) skip(`spot is on the ${cushionSide} side of strike, pick is ${pick}`);
    }
    if (askCents != null && pick) {
      const payCents = pick === "NO" ? 100 - askCents : askCents;
      if (payCents > CONSENSUS_RULES.maxAskCents) skip(`entry ${payCents}¢ above ${CONSENSUS_RULES.maxAskCents}¢ cap`);
    }
    if (pick && modelSide && modelSide !== pick) caution(`model disagrees (${modelSide})`);

    const side = verdict === "SKIP" ? null : pick;

    windows.push({
      ticker,
      closeTime,
      utcHour: new Date(closeTime).getUTCHours(),
      strike,
      decisionSecondsToClose: snap?.seconds_to_close ?? tl?.seconds_to_close ?? null,
      spot,
      cushionUsd,
      askCents,
      studySide,
      studyConfidence: studyConf == null ? null : Number(studyConf.toFixed(4)),
      studyLockedAt: (row["study_locked_at"] as string | null) ?? null,
      skipReason: (row["skip_guard_reason"] as string | null) ?? null,
      modelSide,
      modelConfidence: modelConf == null ? null : Number(modelConf.toFixed(4)),
      trendline: { source: tl ? "shadow_snapshot" : null, buy, mid, sell, position, side: trendSide, distToMidUsd },
      agreement,
      verdict,
      side,
      reasons,
      outcome,
      correct: side && outcome ? side === outcome : null,
    });
  }

  const allow = windows.filter((w) => w.verdict === "ALLOW");
  const cautionW = windows.filter((w) => w.verdict === "CAUTION");
  const allowWins = allow.filter((w) => w.correct === true).length;
  const cautionWins = cautionW.filter((w) => w.correct === true).length;

  return {
    ...base,
    ok: true,
    count: windows.length,
    summary: {
      settledWindows: windows.length,
      allow: allow.length,
      caution: cautionW.length,
      skip: windows.filter((w) => w.verdict === "SKIP").length,
      allowWins,
      allowWinRate: allow.length ? Number((allowWins / allow.length).toFixed(4)) : null,
      cautionWinRate: cautionW.length ? Number((cautionWins / cautionW.length).toFixed(4)) : null,
      trendlineCoverage: windows.length
        ? Number((windows.filter((w) => w.trendline.source).length / windows.length).toFixed(4))
        : 0,
    },
    windows,
  };
}
