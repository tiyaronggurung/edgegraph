// Cron-triggered model-study hook. Public endpoint; pg_cron calls hourly.
// For each user with settled crypto trades in the last 7 days:
//   1. Diagnose new losing trades → crypto_trade_misses
//   2. Recompute shadow-sim for their auto-trade orders
//   3. If ≥ AUTO_STUDY_THRESHOLD new misses since last study, run Gemini study
//
// This ONLY analyzes past trades and writes advisory rows. It never touches
// auto-trade config, gate settings, or places any orders.
import { createFileRoute } from "@tanstack/react-router";

const AUTO_STUDY_THRESHOLD = 5;
const STUDY_MODEL = "google/gemini-3-flash-preview";

// --------- diagnose (mirrors cryptoMisses.functions.ts::diagnose) ---------
function diagnose(trade: {
  side: string | null;
  spot_at_entry: number | null;
  strike: number | null;
  chart_verdict_score: number | null;
  edge_pts: number | null;
  inputs_snapshot: any;
  raw: any;
}) {
  const predicted: "UP" | "DOWN" = trade.side === "YES" ? "UP" : "DOWN";
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
  const cmForecast = snap.candleForecast as string | undefined;
  const cmGuidance = snap.candleGuidance as string | undefined;
  if (cmForecast === "big_red" && predicted === "UP") tags.push("candle_forecast_big_red_ignored");
  if (cmForecast === "big_green" && predicted === "DOWN") tags.push("candle_forecast_big_green_ignored");
  if (cmGuidance === "sell" && predicted === "UP") tags.push("candle_guidance_sell_ignored");
  const tl = snap.trendline as { bias?: string } | undefined;
  if (tl?.bias === "bearish" && predicted === "UP") tags.push("trendline_bearish_vs_long");
  if (tl?.bias === "bullish" && predicted === "DOWN") tags.push("trendline_bullish_vs_short");
  const cv = trade.chart_verdict_score;
  if (cv != null && cv < 55) tags.push(`low_verdict_${Math.round(cv)}`);
  if (trade.edge_pts != null && Math.abs(Number(trade.edge_pts)) < 3) tags.push("thin_edge");
  const regime = snap.regime as string | undefined;
  if (regime && regime !== "trending") tags.push(`regime_${regime}`);
  if (trade.strike != null) {
    const s = Number(trade.strike);
    if (s % 100 === 0 || s % 50 === 0) tags.push("round_strike");
  }
  const reason = tags.length === 0
    ? `Model called ${predicted}, market went ${actual}. No obvious contradicting signal.`
    : `Model called ${predicted}, market went ${actual}. Contradicting signals: ${tags.join(", ")}.`;
  return { predicted, actual, tags, reason, settlePrice };
}

// --------- shadow-sim helpers (mirror cryptoShadowSim.functions.ts) ---------
const SIGMA_THRESHOLDS = [1.0, 1.5, 2.0, 2.5, 3.0];
const EDGE_THRESHOLDS = [2, 3, 5, 7];
const PROB_THRESHOLDS = [0.55, 0.6, 0.65, 0.7];

function simulateRow(o: any) {
  const out: Array<{ gate: string; threshold: any; blocked: boolean }> = [];
  const sigma = o.sigma_distance;
  for (const t of SIGMA_THRESHOLDS) {
    out.push({ gate: "sigmaMin", threshold: { min: t }, blocked: sigma == null ? false : sigma < t });
  }
  const edge = o.edge_pts;
  for (const t of EDGE_THRESHOLDS) {
    out.push({ gate: "edgeMin", threshold: { min: t }, blocked: edge == null ? false : Math.abs(Number(edge)) < t });
  }
  const sp = o.model_prob == null || o.side == null
    ? null
    : (o.side === "YES" ? Number(o.model_prob) : 1 - Number(o.model_prob));
  for (const t of PROB_THRESHOLDS) {
    out.push({ gate: "probMin", threshold: { min: t }, blocked: sp == null ? false : sp < t });
  }
  return out;
}

// --------- Gemini study call ---------
function stripSnapshot(s: any): any {
  if (!s || typeof s !== "object") return s;
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

async function callGemini(prompt: string): Promise<any> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: STUDY_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a quantitative trading coach. Analyze failed BTC 15-min Kalshi predictions and return strict JSON only. Identify common failure modes and propose safe, testable changes. Never recommend disabling risk caps.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content");
  try { return JSON.parse(content); }
  catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned non-JSON");
  }
}

async function processUser(supabaseAdmin: any, userId: string) {
  const stats = { diagnosed: 0, shadow_rows: 0, study_ran: false, study_reason: "" as string | undefined };

  // ---- 1) Diagnose new losing trades ----
  const { data: trades } = await supabaseAdmin
    .from("crypto_trades")
    .select("id, ticker, side, spot_at_entry, strike, pnl_usd, chart_verdict_score, model_prob, edge_pts, inputs_snapshot, raw")
    .eq("user_id", userId)
    .eq("status", "settled")
    .lt("pnl_usd", 0)
    .order("created_at", { ascending: false })
    .limit(50);
  if (trades?.length) {
    const ids = trades.map((t: any) => t.id);
    const { data: existing } = await supabaseAdmin
      .from("crypto_trade_misses")
      .select("trade_id")
      .in("trade_id", ids);
    const seen = new Set((existing ?? []).map((r: any) => r.trade_id));
    const toInsert: any[] = [];
    for (const t of trades as any[]) {
      if (seen.has(t.id)) continue;
      const d = diagnose(t);
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
    if (toInsert.length) {
      const { error } = await supabaseAdmin.from("crypto_trade_misses").insert(toInsert);
      if (!error) stats.diagnosed = toInsert.length;
    }
  }

  // ---- 2) Recompute shadow-sim ----
  const { data: orders } = await supabaseAdmin
    .from("auto_trade_orders")
    .select("id, status, pnl_usd, side, model_prob, edge_pts, sigma_distance")
    .eq("user_id", userId)
    .in("status", ["settled_win", "settled_loss"])
    .not("pnl_usd", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (orders?.length) {
    await supabaseAdmin
      .from("crypto_gate_shadow_sim")
      .delete()
      .eq("user_id", userId)
      .eq("order_source", "auto_trade");
    const inserts: any[] = [];
    for (const o of orders as any[]) {
      const pnl = Number(o.pnl_usd ?? 0);
      const outcome = pnl >= 0 ? "win" : "loss";
      for (const s of simulateRow(o)) {
        inserts.push({
          user_id: userId,
          order_id: o.id,
          order_source: "auto_trade",
          gate_name: s.gate,
          threshold: s.threshold,
          would_have_blocked: s.blocked,
          outcome,
          pnl_usd: pnl,
          pnl_saved: s.blocked ? -pnl : 0,
        });
      }
    }
    const CHUNK = 500;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const slice = inserts.slice(i, i + CHUNK);
      const { error } = await supabaseAdmin.from("crypto_gate_shadow_sim").insert(slice);
      if (error) break;
      stats.shadow_rows += slice.length;
    }
  }

  // ---- 3) Run Gemini study if enough new misses since last study ----
  const { data: latestStudy } = await supabaseAdmin
    .from("crypto_model_studies")
    .select("id, miss_id_watermark, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let newMisses = 0;
  if (latestStudy?.miss_id_watermark) {
    const { data: wm } = await supabaseAdmin
      .from("crypto_trade_misses")
      .select("created_at")
      .eq("id", latestStudy.miss_id_watermark)
      .maybeSingle();
    if (wm?.created_at) {
      const { count } = await supabaseAdmin
        .from("crypto_trade_misses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gt("created_at", wm.created_at);
      newMisses = count ?? 0;
    }
  } else {
    const { count } = await supabaseAdmin
      .from("crypto_trade_misses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    newMisses = count ?? 0;
  }

  if (newMisses < AUTO_STUDY_THRESHOLD) {
    stats.study_reason = `only ${newMisses} new misses (need ${AUTO_STUDY_THRESHOLD})`;
    return stats;
  }

  const { data: misses } = await supabaseAdmin
    .from("crypto_trade_misses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (!misses?.length || misses.length < 3) {
    stats.study_reason = "not enough misses to study";
    return stats;
  }
  const { data: wins } = await supabaseAdmin
    .from("crypto_trades")
    .select("id, ticker, side, spot_at_entry, strike, pnl_usd, chart_verdict_score, edge_pts, inputs_snapshot, raw")
    .eq("user_id", userId).eq("status", "settled").gt("pnl_usd", 0)
    .order("created_at", { ascending: false }).limit(20);
  const { data: priorStudies } = await supabaseAdmin
    .from("crypto_model_studies").select("id")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
  const priorIds = (priorStudies ?? []).map((s: any) => s.id);
  const { data: priorFeedback } = priorIds.length
    ? await supabaseAdmin.from("crypto_study_feedback")
        .select("vote, rec_gate, rec_suggested, note")
        .eq("user_id", userId).in("study_id", priorIds)
    : { data: [] as any[] };

  const missesSlim = (misses as any[]).map(m => ({
    ticker: m.ticker, predicted: m.predicted_dir, actual: m.actual_dir,
    spot: m.spot_at_entry, settle: m.settle_price, strike: m.strike,
    pnl: m.pnl_usd, tags: m.reason_tags, inputs: stripSnapshot(m.inputs_snapshot),
  }));
  const winsSlim = (wins ?? []).map((w: any) => ({
    ticker: w.ticker, side: w.side, spot: w.spot_at_entry, strike: w.strike,
    pnl: w.pnl_usd, verdict: w.chart_verdict_score, edge: w.edge_pts,
    inputs: stripSnapshot(w.inputs_snapshot),
  }));
  const feedbackDigest = (priorFeedback ?? []).map((f: any) => ({
    vote: f.vote, gate: f.rec_gate, suggested: f.rec_suggested, note: f.note ?? null,
  }));

  const prompt = `Analyze these BTC 15-min Kalshi predictions and return JSON:
{
  "summary": "2-4 sentence overview of what went wrong",
  "dominant_failures": ["short label 1", ...],
  "recommendations": [{ "gate": "gate name", "currentSetting": "current", "suggested": "change", "rationale": "why", "priority": "high|medium|low" }]
}

MISSES (${missesSlim.length}): ${JSON.stringify(missesSlim)}
WINS FOR CONTRAST (${winsSlim.length}): ${JSON.stringify(winsSlim)}
PRIOR FEEDBACK (${feedbackDigest.length}): ${JSON.stringify(feedbackDigest)}

Return ONLY the JSON.`;

  let parsed: any;
  try {
    parsed = await callGemini(prompt);
  } catch (e: any) {
    stats.study_reason = `ai_error: ${e?.message ?? String(e)}`;
    return stats;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary : "No summary.";
  const dominant = Array.isArray(parsed.dominant_failures) ? parsed.dominant_failures.slice(0, 10) : [];
  const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 10) : [];

  await supabaseAdmin.from("crypto_model_studies").insert({
    user_id: userId,
    misses_analyzed: missesSlim.length,
    wins_analyzed: winsSlim.length,
    miss_id_watermark: (misses as any[])[0].id,
    model: STUDY_MODEL,
    summary, dominant_failures: dominant, recommendations: recs,
    raw: parsed,
  });
  stats.study_ran = true;
  return stats;
}

export const Route = createFileRoute("/api/public/hooks/crypto-study")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find users with settled trades in the last 7 days.
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabaseAdmin
          .from("crypto_trades")
          .select("user_id")
          .eq("status", "settled")
          .gte("created_at", since)
          .limit(1000);
        const userIds = Array.from(new Set((recent ?? []).map((r: any) => r.user_id)));

        const results: Array<{ userId: string; ok: boolean; stats?: any; error?: string }> = [];
        for (const uid of userIds) {
          try {
            const stats = await processUser(supabaseAdmin, uid);
            results.push({ userId: uid, ok: true, stats });
          } catch (e: any) {
            results.push({ userId: uid, ok: false, error: e?.message ?? String(e) });
          }
        }

        return Response.json({
          ok: true,
          usersProcessed: userIds.length,
          results,
          ranAt: new Date().toISOString(),
        });
      },
    },
  },
});
