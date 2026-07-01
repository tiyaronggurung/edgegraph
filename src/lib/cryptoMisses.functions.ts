// Auto-backtest wrong predictions.
// Walks recently settled crypto_trades with pnl_usd < 0, compares the
// predicted direction (side) against the resolved direction from the
// stored settle raw, and writes a rule-based diagnosis into
// crypto_trade_misses. Idempotent — trade_id is UNIQUE in that table.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MissRow {
  id: string;
  trade_id: string;
  ticker: string;
  predicted_dir: "UP" | "DOWN";
  actual_dir: "UP" | "DOWN" | "FLAT";
  spot_at_entry: number | null;
  settle_price: number | null;
  strike: number | null;
  pnl_usd: number | null;
  reason_tags: string[];
  diagnosed_reason: string;
  inputs_snapshot: any;
  created_at: string;
}

function diagnose(trade: {
  side: string | null;
  spot_at_entry: number | null;
  strike: number | null;
  chart_verdict_score: number | null;
  model_prob: number | null;
  edge_pts: number | null;
  inputs_snapshot: Record<string, unknown> | null;
  raw: Record<string, unknown> | null;
}): { predicted: "UP" | "DOWN"; actual: "UP" | "DOWN" | "FLAT"; tags: string[]; reason: string; settlePrice: number | null } {
  const predicted: "UP" | "DOWN" = trade.side === "YES" ? "UP" : "DOWN";
  // For a losing trade we assume the actual direction was the opposite.
  // If settle raw includes a settle_price, we can be more precise.
  let settlePrice: number | null = null;
  const settleRaw = (trade.raw as any)?.settle;
  if (settleRaw && typeof settleRaw.settle_price === "number") settlePrice = settleRaw.settle_price;
  const spot = trade.spot_at_entry;
  let actual: "UP" | "DOWN" | "FLAT";
  if (settlePrice != null && spot != null) {
    const d = settlePrice - spot;
    actual = Math.abs(d) < 5 ? "FLAT" : d > 0 ? "UP" : "DOWN";
  } else {
    actual = predicted === "UP" ? "DOWN" : "UP";
  }

  const tags: string[] = [];
  const snap = (trade.inputs_snapshot ?? {}) as Record<string, any>;

  // Rule 1 — candle momentum forecast disagreed
  const cmForecast = snap.candleForecast as string | undefined;
  const cmGuidance = snap.candleGuidance as string | undefined;
  if (cmForecast === "big_red" && predicted === "UP") tags.push("candle_forecast_big_red_ignored");
  if (cmForecast === "big_green" && predicted === "DOWN") tags.push("candle_forecast_big_green_ignored");
  if (cmGuidance === "sell" && predicted === "UP") tags.push("candle_guidance_sell_ignored");

  // Rule 2 — trendline against us
  const tl = snap.trendline as { bias?: string; slope?: number } | undefined;
  if (tl?.bias === "bearish" && predicted === "UP") tags.push("trendline_bearish_vs_long");
  if (tl?.bias === "bullish" && predicted === "DOWN") tags.push("trendline_bullish_vs_short");

  // Rule 3 — verdict score marginal
  const cv = trade.chart_verdict_score;
  if (cv != null && cv < 55) tags.push(`low_verdict_${Math.round(cv)}`);

  // Rule 4 — thin edge
  if (trade.edge_pts != null && Math.abs(Number(trade.edge_pts)) < 3) tags.push("thin_edge");

  // Rule 5 — regime
  const regime = snap.regime as string | undefined;
  if (regime && regime !== "trending") tags.push(`regime_${regime}`);

  // Rule 6 — round-number magnet (if strike is a round 50/100 and we bet against magnet)
  if (trade.strike != null) {
    const s = Number(trade.strike);
    if (s % 100 === 0 || s % 50 === 0) tags.push("round_strike");
  }

  let reason: string;
  if (tags.length === 0) {
    reason = `Model called ${predicted}, market went ${actual}. No obvious contradicting signal in captured inputs — likely noise or missing signal.`;
  } else {
    reason = `Model called ${predicted}, market went ${actual}. Contradicting signals present: ${tags.join(", ")}.`;
  }
  return { predicted, actual, tags, reason, settlePrice };
}

export const diagnoseRecentMisses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ diagnosed: number }> => {
    const { supabase, userId } = context;
    // Look at recently settled trades with a realized loss that we haven't
    // logged a miss for yet. Cap at 50 per call.
    const { data: trades, error } = await supabase
      .from("crypto_trades")
      .select("id, ticker, side, spot_at_entry, strike, pnl_usd, chart_verdict_score, model_prob, edge_pts, inputs_snapshot, raw")
      .eq("user_id", userId)
      .eq("status", "settled")
      .lt("pnl_usd", 0)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    if (!trades?.length) return { diagnosed: 0 };

    const ids = trades.map(t => t.id);
    const { data: existing } = await supabase
      .from("crypto_trade_misses")
      .select("trade_id")
      .in("trade_id", ids);
    const seen = new Set((existing ?? []).map((r: any) => r.trade_id));

    const toInsert = [];
    for (const t of trades) {
      if (seen.has(t.id)) continue;
      const d = diagnose(t as any);
      toInsert.push({
        user_id: userId,
        trade_id: t.id,
        ticker: t.ticker,
        predicted_dir: d.predicted,
        actual_dir: d.actual,
        spot_at_entry: t.spot_at_entry,
        settle_price: d.settlePrice,
        strike: t.strike,
        pnl_usd: t.pnl_usd,
        reason_tags: d.tags,
        diagnosed_reason: d.reason,
        inputs_snapshot: t.inputs_snapshot ?? null,
      });
    }
    if (!toInsert.length) return { diagnosed: 0 };
    const { error: insErr } = await supabase.from("crypto_trade_misses").insert(toInsert);
    if (insErr) throw new Error(insErr.message);
    return { diagnosed: toInsert.length };
  });

export const listRecentMisses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ misses: MissRow[] }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("crypto_trade_misses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { misses: (data ?? []) as MissRow[] };
  });

// ─────────────────────────────────────────────────────────────────────────────
// LLM study of wrong predictions.
// Auto-triggered every N new misses (see AUTO_STUDY_THRESHOLD). Reads recent
// misses + a small sample of wins for contrast, sends to Gemini via Lovable
// AI Gateway, stores structured recommendations + summary. UI shows the
// latest study; user reviews and manually applies gate/threshold changes.
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_STUDY_THRESHOLD = 5;
const STUDY_MODEL = "google/gemini-3-flash-preview";

export interface StudyRecommendation {
  gate: string;
  currentSetting: string;
  suggested: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

export interface StudyRow {
  id: string;
  misses_analyzed: number;
  wins_analyzed: number;
  model: string;
  summary: string;
  dominant_failures: string[];
  recommendations: StudyRecommendation[];
  created_at: string;
  feedback?: Record<number, "up" | "down">;
}

export interface StudyFeedbackRow {
  study_id: string;
  rec_index: number;
  vote: "up" | "down";
}


function stripSnapshot(s: any): any {
  if (!s || typeof s !== "object") return s;
  // Trim to fields we actually reason about; skip raw kalshi blobs.
  const keys = [
    "source", "verdictScore", "candleForecast", "candleGuidance",
    "trendline", "regime", "sigmaDistance", "gateAction",
    "momentumAlignsWithSide", "convictionMult", "edgePts",
    "modelYesProb", "marketYesPrice", "equityAdjust", "equityBlock",
    "spot", "strike",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in s) out[k] = s[k];
  return out;
}

async function callLovableAi(prompt: string): Promise<any> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: STUDY_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a quantitative trading coach. Analyze failed BTC 15-min Kalshi predictions and return strict JSON only (no prose, no markdown fences). " +
            "Identify the most common failure modes across the sample and propose specific, safe, testable changes to gates and thresholds. " +
            "Never recommend disabling risk caps. Never invent gates that were not present in the input.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (res.status === 429) throw new Error("AI rate limited — try again shortly");
  if (res.status === 402) throw new Error("AI credits exhausted — top up in Settings → Plans");
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content");
  try {
    return JSON.parse(content);
  } catch {
    // Try to salvage — sometimes models wrap in fences despite response_format
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned non-JSON: " + content.slice(0, 200));
  }
}

export const studyMissesWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ran: boolean; studyId?: string; reason?: string }> => {
    const { supabase, userId } = context;

    // Load recent misses.
    const { data: misses, error: mErr } = await supabase
      .from("crypto_trade_misses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (mErr) throw new Error(mErr.message);
    if (!misses?.length) return { ran: false, reason: "no misses yet" };
    if (misses.length < 3) return { ran: false, reason: "need at least 3 misses to study" };

    // Load recent wins for contrast.
    const { data: wins } = await supabase
      .from("crypto_trades")
      .select("id, ticker, side, spot_at_entry, strike, pnl_usd, chart_verdict_score, edge_pts, inputs_snapshot, raw")
      .eq("user_id", userId)
      .eq("status", "settled")
      .gt("pnl_usd", 0)
      .order("created_at", { ascending: false })
      .limit(20);

    // Load prior recommendation feedback so the model learns what helped.
    const { data: priorStudies } = await supabase
      .from("crypto_model_studies")
      .select("id, recommendations, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);
    const priorIds = (priorStudies ?? []).map((s: any) => s.id);
    const { data: priorFeedback } = priorIds.length
      ? await supabase
          .from("crypto_study_feedback")
          .select("study_id, rec_index, vote, rec_gate, rec_suggested, note")
          .eq("user_id", userId)
          .in("study_id", priorIds)
      : { data: [] as any[] };
    const feedbackDigest = (priorFeedback ?? []).map((f: any) => ({
      vote: f.vote,
      gate: f.rec_gate,
      suggested: f.rec_suggested,
      note: f.note ?? null,
    }));


    const missesSlim = misses.map((m: any) => ({
      ticker: m.ticker,
      predicted: m.predicted_dir,
      actual: m.actual_dir,
      spot: m.spot_at_entry,
      settle: m.settle_price,
      strike: m.strike,
      pnl: m.pnl_usd,
      tags: m.reason_tags,
      inputs: stripSnapshot(m.inputs_snapshot),
    }));
    const winsSlim = (wins ?? []).map((w: any) => ({
      ticker: w.ticker,
      side: w.side,
      spot: w.spot_at_entry,
      strike: w.strike,
      pnl: w.pnl_usd,
      verdict: w.chart_verdict_score,
      edge: w.edge_pts,
      inputs: stripSnapshot(w.inputs_snapshot),
    }));

    const prompt = `Analyze these BTC 15-min Kalshi predictions and return JSON with this exact shape:
{
  "summary": "2-4 sentence overview of what went wrong across the misses",
  "dominant_failures": ["short label 1", "short label 2", ...],
  "recommendations": [
    {
      "gate": "name of gate or threshold (must be one referenced in the inputs, e.g. candleGate, trendlineGate, sigmaDistance, edgePts, verdictScore)",
      "currentSetting": "what it looks like now based on the data",
      "suggested": "concrete change (e.g. 'enable candleGate', 'raise minSigma from 1.5 to 2.0', 'skip trades with verdictScore < 60')",
      "rationale": "why this would have helped, with reference to the miss data",
      "priority": "high" | "medium" | "low"
    }
  ]
}

MISSES (${missesSlim.length}):
${JSON.stringify(missesSlim)}

RECENT WINS FOR CONTRAST (${winsSlim.length}):
${JSON.stringify(winsSlim)}

PRIOR RECOMMENDATION FEEDBACK FROM THE USER (${feedbackDigest.length}) — vote "up" means the recommendation was helpful, "down" means it was not. Favor patterns similar to the up-voted ones and avoid repeating the substance of down-voted ones:
${JSON.stringify(feedbackDigest)}

Return ONLY the JSON object.`;


    const parsed = await callLovableAi(prompt);
    const summary = typeof parsed.summary === "string" ? parsed.summary : "No summary returned.";
    const dominant = Array.isArray(parsed.dominant_failures) ? parsed.dominant_failures.slice(0, 10) : [];
    const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 10) : [];

    const { data: inserted, error: insErr } = await supabase
      .from("crypto_model_studies")
      .insert({
        user_id: userId,
        misses_analyzed: missesSlim.length,
        wins_analyzed: winsSlim.length,
        miss_id_watermark: misses[0].id,
        model: STUDY_MODEL,
        summary,
        dominant_failures: dominant,
        recommendations: recs,
        raw: parsed,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    return { ran: true, studyId: inserted!.id };
  });

export const getLatestStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ study: StudyRow | null; needsRun: boolean; newMissesSinceStudy: number }> => {
    const { supabase, userId } = context;
    const { data: latest } = await supabase
      .from("crypto_model_studies")
      .select("id, misses_analyzed, wins_analyzed, model, summary, dominant_failures, recommendations, created_at, miss_id_watermark")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Count how many misses were created after the watermark
    let newSince = 0;
    if (latest?.miss_id_watermark) {
      const { data: wm } = await supabase
        .from("crypto_trade_misses")
        .select("created_at")
        .eq("id", latest.miss_id_watermark)
        .maybeSingle();
      if (wm?.created_at) {
        const { count } = await supabase
          .from("crypto_trade_misses")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gt("created_at", wm.created_at);
        newSince = count ?? 0;
      }
    } else {
      const { count } = await supabase
        .from("crypto_trade_misses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      newSince = count ?? 0;
    }

    let feedback: Record<number, "up" | "down"> = {};
    if (latest) {
      const { data: fb } = await supabase
        .from("crypto_study_feedback")
        .select("rec_index, vote")
        .eq("user_id", userId)
        .eq("study_id", latest.id);
      for (const r of (fb ?? []) as any[]) feedback[r.rec_index] = r.vote;
    }

    const study: StudyRow | null = latest
      ? {
          id: latest.id,
          misses_analyzed: latest.misses_analyzed,
          wins_analyzed: latest.wins_analyzed,
          model: latest.model,
          summary: latest.summary,
          dominant_failures: (latest.dominant_failures as unknown as string[]) ?? [],
          recommendations: (latest.recommendations as unknown as StudyRecommendation[]) ?? [],
          created_at: latest.created_at,
          feedback,
        }
      : null;

    return {
      study,
      needsRun: newSince >= AUTO_STUDY_THRESHOLD,
      newMissesSinceStudy: newSince,
    };
  });

export const setRecommendationFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { studyId: string; recIndex: number; vote: "up" | "down" | null; recGate?: string; recSuggested?: string; note?: string }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    if (data.vote === null) {
      const { error } = await supabase
        .from("crypto_study_feedback")
        .delete()
        .eq("user_id", userId)
        .eq("study_id", data.studyId)
        .eq("rec_index", data.recIndex);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase
      .from("crypto_study_feedback")
      .upsert(
        {
          user_id: userId,
          study_id: data.studyId,
          rec_index: data.recIndex,
          rec_gate: data.recGate ?? null,
          rec_suggested: data.recSuggested ?? null,
          vote: data.vote,
          note: data.note ?? null,
        },
        { onConflict: "user_id,study_id,rec_index" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });


