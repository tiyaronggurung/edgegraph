// Server-only: single "should the copy-trader act?" verdict for the live
// BTC 15m Kalshi window, merging the three signals this app already produces:
//
//   1. Model pick   — btc_model_predictions.side / model_prob
//   2. Study pick   — the T7 locked side (study_locked_side + confidence)
//   3. Trendline    — buy / mid / sell levels from getBtcLevels()
//
// Read-only. Places no orders and touches no trading path. Consumed by
// GET /api/public/btc/consensus from another app right before it mirrors a
// Polymarket fill onto Kalshi.
//
// Thresholds come straight from our own settled-window audits:
//   - the 120..300s to close band runs 88%+; outside it degrades fast
//   - |spot - MID| < $25 inside the channel is a coin flip (~65%) → skip
//   - study wins 81.9% of study/model disagreements → study is the tiebreak
//   - cushion (|spot - strike|) < $40 is where last-minute flips cluster
//   - study+model agreement alone is only 72.5% (27.5% both wrong) → not a pass

import { getBtcLevels, type BtcLevels } from "@/lib/btcLevels.server";
import { getKalshiImpliedSpot } from "@/lib/kalshiImpliedSpot.functions";

export const CONSENSUS_RULES = {
  minSecondsToClose: 60,
  maxSecondsToClose: 300,
  minMidDistanceUsd: 25,
  minCushionUsd: 40,
  minStudyConf: 0.75,
  maxAskCents: 70,
} as const;

export type Side = "YES" | "NO";
export type Verdict = "ALLOW" | "CAUTION" | "SKIP";

export interface ConsensusResponse {
  ok: boolean;
  asOf: string;
  ticker: string | null;
  strike: number | null;
  spot: number | null;
  secondsToClose: number | null;
  askCents: number | null;
  cushionUsd: number | null;

  model: { side: Side | null; confidence: number | null };
  study: { side: Side | null; confidence: number | null; lockedAt: string | null; skipReason: string | null };
  trendline: {
    side: Side | null;
    buy: number | null;
    mid: number | null;
    sell: number | null;
    position: BtcLevels["position"];
    distToMidUsd: number | null;
    broke: "buy" | "sell" | null;
  };

  agreement: "all_three" | "study_trendline" | "model_trendline" | "study_model" | "split" | "unknown";
  verdict: Verdict;
  side: Side | null;
  confidence: number | null;
  reasons: string[];
  rules: typeof CONSENSUS_RULES;
  error: string | null;
}

const asSide = (v: unknown): Side | null => (v === "YES" || v === "NO" ? v : null);

export async function getBtcConsensus(): Promise<ConsensusResponse> {
  const asOf = new Date().toISOString();
  const base: ConsensusResponse = {
    ok: false,
    asOf,
    ticker: null, strike: null, spot: null, secondsToClose: null, askCents: null, cushionUsd: null,
    model: { side: null, confidence: null },
    study: { side: null, confidence: null, lockedAt: null, skipReason: null },
    trendline: { side: null, buy: null, mid: null, sell: null, position: "unknown", distToMidUsd: null, broke: null },
    agreement: "unknown",
    verdict: "SKIP",
    side: null,
    confidence: null,
    reasons: [],
    rules: CONSENSUS_RULES,
    error: null,
  };

  // All three upstreams fire together. The prediction row is fetched
  // speculatively (latest row, no ticker filter) so it does not wait on the
  // Kalshi round-trip; if the ticker turns out to be stale we re-query.
  const [levelsRes, flowRes, predRes] = await Promise.allSettled([
    getBtcLevels({ limit: 120 }),
    getKalshiImpliedSpot(),
    fetchLatestPrediction(null),
  ]);

  const levels = levelsRes.status === "fulfilled" ? levelsRes.value : null;
  const flow = flowRes.status === "fulfilled" ? flowRes.value : null;
  const speculativePred = predRes.status === "fulfilled" ? predRes.value : null;

  if (!flow?.ok || !flow.ticker || flow.strike == null) {
    return { ...base, reasons: ["no live kalshi 15m market"], error: flow?.error ?? "kalshi unavailable" };
  }
  if (!levels?.ok) {
    return {
      ...base,
      ticker: flow.ticker,
      strike: flow.strike,
      secondsToClose: flow.secondsToClose,
      reasons: ["trendline levels unavailable"],
      error: levels?.error ?? "levels unavailable",
    };
  }

  const spot = levels.spot;
  const strike = flow.strike;
  const stc = flow.secondsToClose;
  const askCents = flow.yesAsk != null ? Math.round(flow.yesAsk * 100) : null;
  const cushionUsd = spot != null ? Number((spot - strike).toFixed(2)) : null;

  // --- Trendline vote -------------------------------------------------------
  const broke: "buy" | "sell" | null =
    levels.position === "above_sell" ? "sell" : levels.position === "below_buy" ? "buy" : null;
  const trendSide: Side | null =
    levels.position === "above_sell" || levels.position === "upper_half"
      ? "YES"
      : levels.position === "below_buy" || levels.position === "lower_half"
        ? "NO"
        : null;

  // --- Model + study picks --------------------------------------------------
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pred } = await supabaseAdmin
    .from("btc_model_predictions")
    .select(
      "side, model_prob, model_side_pre_study, study_locked_side, study_lock_confidence, study_locked_at, skip_guard_reason",
    )
    .eq("ticker", flow.ticker)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = (pred ?? {}) as Record<string, unknown>;
  const modelSide = asSide(row["model_side_pre_study"]) ?? asSide(row["side"]);
  const modelProbRaw = row["model_prob"] == null ? null : Number(row["model_prob"]);
  // model_prob is P(YES); express it as confidence in the model's own side.
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

  // --- Agreement ------------------------------------------------------------
  let agreement: ConsensusResponse["agreement"] = "split";
  if (studySide && modelSide && trendSide && studySide === modelSide && modelSide === trendSide) agreement = "all_three";
  else if (studySide && trendSide && studySide === trendSide) agreement = "study_trendline";
  else if (modelSide && trendSide && modelSide === trendSide) agreement = "model_trendline";
  else if (studySide && modelSide && studySide === modelSide) agreement = "study_model";
  if (!studySide && !modelSide && !trendSide) agreement = "unknown";

  // --- Verdict --------------------------------------------------------------
  // Study is the decision-maker (81.9% of disagreements); model is a
  // confirmation only. Without a study lock we never return ALLOW.
  const reasons: string[] = [];
  const pick: Side | null = studySide ?? null;
  const state: { verdict: Verdict } = { verdict: "ALLOW" };
  const skip = (r: string) => { reasons.push(r); state.verdict = "SKIP"; };
  const caution = (r: string) => { reasons.push(r); if (state.verdict !== "SKIP") state.verdict = "CAUTION"; };

  if (!pick) {
    skip(
      row["skip_guard_reason"]
        ? `no T7 study lock (${String(row["skip_guard_reason"])})`
        : "no T7 study lock for this window",
    );
  }
  if (stc == null) skip("unknown time to close");
  else if (stc > CONSENSUS_RULES.maxSecondsToClose) skip(`too early: ${stc}s to close (> ${CONSENSUS_RULES.maxSecondsToClose}s)`);
  else if (stc < CONSENSUS_RULES.minSecondsToClose) skip(`too late: ${stc}s to close (< ${CONSENSUS_RULES.minSecondsToClose}s)`);

  if (studyConf != null && studyConf < CONSENSUS_RULES.minStudyConf) {
    skip(`study confidence ${(studyConf * 100).toFixed(0)}% below ${CONSENSUS_RULES.minStudyConf * 100}%`);
  }

  if (levels.distToMidUsd == null) skip("no MID distance");
  else if (Math.abs(levels.distToMidUsd) < CONSENSUS_RULES.minMidDistanceUsd) {
    skip(`|spot - MID| $${Math.abs(levels.distToMidUsd).toFixed(0)} < $${CONSENSUS_RULES.minMidDistanceUsd} (coin-flip zone)`);
  }

  if (cushionUsd == null) skip("no cushion");
  else if (Math.abs(cushionUsd) < CONSENSUS_RULES.minCushionUsd) {
    skip(`cushion $${Math.abs(cushionUsd).toFixed(0)} < $${CONSENSUS_RULES.minCushionUsd} (flip-prone)`);
  }

  // Hard veto: trendline zone contradicting the study pick.
  if (pick && trendSide && trendSide !== pick) {
    skip(`trendline zone (${levels.position}) contradicts study pick ${pick}`);
  }

  // Cushion must point the same way as the pick (spot above strike ⇒ YES).
  if (pick && cushionUsd != null) {
    const cushionSide: Side = cushionUsd >= 0 ? "YES" : "NO";
    if (cushionSide !== pick) skip(`spot is on the ${cushionSide} side of strike, pick is ${pick}`);
  }

  if (askCents != null) {
    const payCents = pick === "NO" ? 100 - askCents : askCents;
    if (payCents > CONSENSUS_RULES.maxAskCents) skip(`entry ${payCents}¢ above ${CONSENSUS_RULES.maxAskCents}¢ cap`);
  }

  if (pick && modelSide && modelSide !== pick) {
    caution(`model disagrees (${modelSide}) — study historically right 81.9% here`);
  }
  if (broke == null) caution("inside channel (no BUY/SELL break)");

  if (state.verdict === "ALLOW") reasons.push(`study ${pick} confirmed by trendline ${levels.position} and $${Math.abs(cushionUsd ?? 0).toFixed(0)} cushion`);

  return {
    ok: true,
    asOf,
    ticker: flow.ticker,
    strike,
    spot,
    secondsToClose: stc,
    askCents,
    cushionUsd,
    model: { side: modelSide, confidence: modelConf == null ? null : Number(modelConf.toFixed(4)) },
    study: {
      side: studySide,
      confidence: studyConf == null ? null : Number(studyConf.toFixed(4)),
      lockedAt: (row["study_locked_at"] as string | null) ?? null,
      skipReason: (row["skip_guard_reason"] as string | null) ?? null,
    },
    trendline: {
      side: trendSide,
      buy: levels.buy,
      mid: levels.mid,
      sell: levels.sell,
      position: levels.position,
      distToMidUsd: levels.distToMidUsd,
      broke,
    },
    agreement,
    verdict: state.verdict,
    side: state.verdict === "SKIP" ? null : pick,
    confidence: state.verdict === "SKIP" ? null : (studyConf ?? null),
    reasons,
    rules: CONSENSUS_RULES,
    error: null,
  };
}
