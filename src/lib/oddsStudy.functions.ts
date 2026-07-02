// AI-driven odds-study system.
// - runOddsStudy: manual + cron trigger. Analyzes recent auto_odds_study_log
//   rows + settled auto-odds trades via Gemini, writes an auto_odds_studies
//   row. If auto_apply_studies is on, applies safe tunings immediately.
// - applyTuning: manually apply a single proposed tuning from a study.
// - revertTuning: undo an applied tuning via the audit trail.
// - getLatestOddsStudy: read the most recent study for the current user.
//
// Safety: every tunable has a hardcoded safe range + max delta enforced here.
// The LLM cannot disable loss caps or trade sizes.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─────────────────────── tunable whitelist ───────────────────────
// Only these params can be changed by AI studies. Everything else in the
// auto-odds tick is off-limits.
type TunableName =
  | "model_gate_min" | "hedge_band_lo" | "hedge_band_hi"
  | "tp_cents" | "oscillation_max"
  | "skip_bucket_lt15s" | "skip_bucket_15_60s";

interface TunableDef {
  kind: "number" | "bool";
  default: number | boolean;
  min?: number;
  max?: number;
  maxDelta?: number;
}

export const TUNABLE_DEFS: Record<TunableName, TunableDef> = {
  model_gate_min:     { kind: "number", default: 0.60, min: 0.55, max: 0.75, maxDelta: 0.03 },
  hedge_band_lo:      { kind: "number", default: 0.60, min: 0.55, max: 0.65, maxDelta: 0.02 },
  hedge_band_hi:      { kind: "number", default: 0.68, min: 0.63, max: 0.75, maxDelta: 0.02 },
  tp_cents:           { kind: "number", default: 98,   min: 95,   max: 99,   maxDelta: 1 },
  oscillation_max:    { kind: "number", default: 3,    min: 2,    max: 5,    maxDelta: 1 },
  skip_bucket_lt15s:  { kind: "bool",   default: false },
  skip_bucket_15_60s: { kind: "bool",   default: false },
};

function coerceTuning(param: string, suggested: unknown, current: unknown): { ok: true; value: number | boolean } | { ok: false; reason: string } {
  const def = TUNABLE_DEFS[param as TunableName];
  if (!def) return { ok: false, reason: "unknown param" };
  if (def.kind === "bool") {
    if (typeof suggested !== "boolean") return { ok: false, reason: "not bool" };
    return { ok: true, value: suggested };
  }
  const v = Number(suggested);
  if (!Number.isFinite(v)) return { ok: false, reason: "not number" };
  if (def.min != null && v < def.min) return { ok: false, reason: `< min ${def.min}` };
  if (def.max != null && v > def.max) return { ok: false, reason: `> max ${def.max}` };
  const cur = typeof current === "number" ? current : Number(def.default);
  if (def.maxDelta != null && Math.abs(v - cur) > def.maxDelta) {
    return { ok: false, reason: `Δ ${Math.abs(v - cur).toFixed(3)} > max ${def.maxDelta}` };
  }
  return { ok: true, value: v };
}

// ─────────────────────── Gemini call ───────────────────────
const STUDY_MODEL = "google/gemini-3-flash-preview";

async function callGemini(prompt: string, systemPrompt: string): Promise<any> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: STUDY_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j: any = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content");
  try { return JSON.parse(content); } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned non-JSON");
  }
}

// ─────────────────────── core (shared with cron) ───────────────────────
/**
 * Runs an odds study for one user. Called by both the runOddsStudy server fn
 * and the crypto-study cron hook. Writes an auto_odds_studies row, applies
 * safe tunings when auto_apply_studies is on, and returns a small summary.
 */
export async function runOddsStudyCore(supabaseAdmin: any, userId: string): Promise<{ ran: boolean; reason?: string; studyId?: string; applied?: number }> {
  // Load recent study snapshots.
  const { data: logs } = await supabaseAdmin
    .from("auto_odds_study_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!logs || logs.length < 20) {
    return { ran: false, reason: `only ${logs?.length ?? 0} snapshots (need 20)` };
  }

  // Load recent settled auto-odds trades (context for the LLM).
  const { data: recentOrders } = await supabaseAdmin
    .from("auto_trade_orders")
    .select("id, ticker, side, status, entry_price_cents, close_price_cents, pnl_usd, created_at")
    .eq("user_id", userId)
    .in("status", ["settled_win", "settled_loss"])
    .order("created_at", { ascending: false })
    .limit(50);

  // Load current settings (to include current tunable values).
  const { data: settings } = await supabaseAdmin
    .from("auto_odds_settings")
    .select("model_gate_min, hedge_band_lo, hedge_band_hi, tp_cents, oscillation_max, skip_bucket_lt15s, skip_bucket_15_60s, auto_apply_studies")
    .eq("user_id", userId)
    .maybeSingle();

  const cur: Record<TunableName, number | boolean> = {
    model_gate_min:     settings?.model_gate_min     ?? (TUNABLE_DEFS.model_gate_min.default as number),
    hedge_band_lo:      settings?.hedge_band_lo      ?? (TUNABLE_DEFS.hedge_band_lo.default as number),
    hedge_band_hi:      settings?.hedge_band_hi      ?? (TUNABLE_DEFS.hedge_band_hi.default as number),
    tp_cents:           settings?.tp_cents           ?? (TUNABLE_DEFS.tp_cents.default as number),
    oscillation_max:    settings?.oscillation_max    ?? (TUNABLE_DEFS.oscillation_max.default as number),
    skip_bucket_lt15s:  settings?.skip_bucket_lt15s  ?? (TUNABLE_DEFS.skip_bucket_lt15s.default as boolean),
    skip_bucket_15_60s: settings?.skip_bucket_15_60s ?? (TUNABLE_DEFS.skip_bucket_15_60s.default as boolean),
  };

  // Aggregate stats.
  const BUCKETS = [">120s", "60-120s", "15-60s", "<15s"] as const;
  const withPrior = logs.filter((r: any) => r.yes_cents_delta != null);
  const totalFlips = logs.filter((r: any) => r.crossed_50).length;
  const byBucket = BUCKETS.map(b => {
    const rows = logs.filter((r: any) => r.time_bucket === b);
    const flips = rows.filter((r: any) => r.crossed_50).length;
    const entered = rows.filter((r: any) => r.entered).length;
    return { bucket: b, count: rows.length, flipRate: rows.length ? flips / rows.length : 0, entered };
  });
  const wins = (recentOrders ?? []).filter((o: any) => o.status === "settled_win").length;
  const losses = (recentOrders ?? []).filter((o: any) => o.status === "settled_loss").length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

  // Prior applied tunings (for LLM context on what's already been tried).
  const { data: prevAudit } = await supabaseAdmin
    .from("auto_odds_tuning_audit")
    .select("param, prev_value, new_value, created_at, reverted_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(15);

  // Build prompt.
  const systemPrompt = `You are a quantitative trading coach studying BTC 15-min Kalshi odds behavior.
You analyze the relationship between BTC spot price, YES/NO cent prices, and time-to-close (flip rate = how often the picked side crossed 50¢).
Your goal: identify when odds flip unpredictably (coin-flip zones) and recommend safe parameter tunings.
Return STRICT JSON only. Never recommend disabling loss caps or trade size.`;

  const paramSchema = Object.entries(TUNABLE_DEFS).map(([name, d]) => {
    if (d.kind === "bool") return `- ${name}: bool (currently ${cur[name as TunableName]})`;
    return `- ${name}: number in [${d.min},${d.max}], max Δ per study ${d.maxDelta} (currently ${cur[name as TunableName]})`;
  }).join("\n");

  const prompt = `Analyze this data and return JSON with shape:
{
  "summary": "2-3 sentence overview of price vs odds vs time relationship",
  "findings": {
    "flip_zones": ["short phrases describing when flips happen"],
    "price_odds_relationship": "short description",
    "time_bucket_observations": ["short phrases per bucket if relevant"]
  },
  "tunings": [
    {
      "param": "<one of the whitelisted params>",
      "suggested": <number or bool>,
      "rationale": "why this change helps",
      "confidence": <0..1>
    }
  ]
}

Only propose tunings when data supports it. Prefer fewer, higher-confidence recommendations. Never propose values outside safe ranges — they will be rejected.

Whitelisted params (only these are tunable):
${paramSchema}

DATA:
- Snapshots analyzed: ${logs.length}
- Total flips (crossed 50¢): ${totalFlips} (${logs.length ? ((totalFlips/logs.length)*100).toFixed(1) : "0"}%)
- Per-bucket: ${JSON.stringify(byBucket)}
- Recent trades: ${wins}W / ${losses}L (winRate ${winRate == null ? "n/a" : (winRate*100).toFixed(1)+"%"})
- Prior applied tunings (last 15): ${JSON.stringify(prevAudit ?? [])}
- Sample snapshots (10): ${JSON.stringify((withPrior.slice(0,10)).map((r: any) => ({
    bucket: r.time_bucket, seconds: r.seconds_to_close, picked: r.picked_side,
    modelP: r.model_side_prob, dCents: r.yes_cents_delta, dSpot: r.spot_delta,
    crossed50: r.crossed_50, entered: r.entered,
  })))}

Return ONLY the JSON.`;

  let parsed: any;
  try {
    parsed = await callGemini(prompt, systemPrompt);
  } catch (e: any) {
    return { ran: false, reason: `ai_error: ${e?.message ?? String(e)}` };
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const findings = (parsed.findings && typeof parsed.findings === "object") ? parsed.findings : {};
  const rawTunings = Array.isArray(parsed.tunings) ? parsed.tunings.slice(0, 10) : [];

  // Validate and (optionally) apply tunings.
  const autoApply = settings?.auto_apply_studies === true;
  const appliedTunings: any[] = [];
  const pendingTunings: any[] = [];
  for (const t of rawTunings) {
    if (!t || typeof t.param !== "string") continue;
    const check = coerceTuning(t.param, t.suggested, cur[t.param as TunableName]);
    const conf = typeof t.confidence === "number" ? Math.max(0, Math.min(1, t.confidence)) : 0;
    if (!check.ok) {
      // Log the rejection reason but don't apply/show.
      pendingTunings.push({ ...t, confidence: conf, rejected: check.reason });
      continue;
    }
    const record = { param: t.param, suggested: check.value, current: cur[t.param as TunableName], rationale: String(t.rationale ?? ""), confidence: conf };
    if (autoApply && conf >= 0.7) {
      appliedTunings.push(record);
    } else {
      pendingTunings.push(record);
    }
  }

  // Insert study row.
  const { data: studyRow, error: studyErr } = await supabaseAdmin
    .from("auto_odds_studies")
    .insert({
      user_id: userId,
      summary,
      findings,
      tunings: pendingTunings,
      applied_tunings: appliedTunings,
      model: STUDY_MODEL,
      raw: parsed,
      rows_analyzed: logs.length,
    })
    .select("id")
    .maybeSingle();
  if (studyErr || !studyRow) {
    return { ran: false, reason: `insert_error: ${studyErr?.message ?? "unknown"}` };
  }

  // Apply and audit.
  if (appliedTunings.length > 0) {
    const patch: Record<string, any> = {};
    const auditRows: any[] = [];
    for (const r of appliedTunings) {
      patch[r.param] = r.suggested;
      auditRows.push({
        user_id: userId,
        study_id: studyRow.id,
        param: r.param,
        prev_value: cur[r.param as TunableName],
        new_value: r.suggested,
        rationale: r.rationale,
        confidence: r.confidence,
        source: "ai_auto",
      });
    }
    // Upsert settings.
    await supabaseAdmin.from("auto_odds_settings").update(patch as any).eq("user_id", userId);
    if (auditRows.length) await supabaseAdmin.from("auto_odds_tuning_audit").insert(auditRows);
  }

  return { ran: true, studyId: studyRow.id, applied: appliedTunings.length };
}

// ─────────────────────── server functions ───────────────────────

export const runOddsStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Throttle: 5 min between manual runs.
    const { data: recent } = await supabaseAdmin
      .from("auto_odds_studies")
      .select("created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.created_at) {
      const age = Date.now() - new Date(recent.created_at).getTime();
      if (age < 5 * 60_000) {
        return { ok: false as const, error: `wait ${Math.ceil((5 * 60_000 - age) / 1000)}s before next study` };
      }
    }
    const res = await runOddsStudyCore(supabaseAdmin as any, context.userId);
    return { ok: res.ran as any, ...res };
  });

export const getLatestOddsStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("auto_odds_studies")
      .select("id, summary, findings, tunings, applied_tunings, model, rows_analyzed, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { study: data };
  });

const ApplyInput = z.object({ studyId: z.string().uuid(), param: z.string() });
export const applyTuning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ApplyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: study } = await supabaseAdmin
      .from("auto_odds_studies")
      .select("id, user_id, tunings, applied_tunings")
      .eq("id", data.studyId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!study) return { ok: false as const, error: "study not found" };
    const pending = Array.isArray(study.tunings) ? (study.tunings as any[]) : [];
    const t = pending.find((x: any) => x && typeof x === "object" && x.param === data.param) as any;
    if (!t) return { ok: false as const, error: "tuning not found or already applied" };

    const { data: settings } = await supabaseAdmin
      .from("auto_odds_settings")
      .select(data.param)
      .eq("user_id", context.userId)
      .maybeSingle();
    const cur = (settings as any)?.[data.param] ?? (TUNABLE_DEFS as any)[data.param]?.default;

    const check = coerceTuning(data.param, t.suggested, cur);
    if (!check.ok) return { ok: false as const, error: `unsafe: ${check.reason}` };

    await supabaseAdmin.from("auto_odds_settings").update({ [data.param]: check.value } as any).eq("user_id", context.userId);
    await supabaseAdmin.from("auto_odds_tuning_audit").insert({
      user_id: context.userId, study_id: data.studyId, param: data.param,
      prev_value: cur, new_value: check.value,
      rationale: t.rationale ?? "", confidence: t.confidence ?? null,
      source: "user_apply",
    });
    // Move from pending to applied on the study row.
    const remaining = pending.filter((x: any) => !x || x.param !== data.param);
    const applied = Array.isArray(study.applied_tunings) ? (study.applied_tunings as any[]) : [];
    await supabaseAdmin.from("auto_odds_studies").update({
      tunings: remaining,
      applied_tunings: [...applied, { ...t, current: cur, applied_at: new Date().toISOString() }],
    }).eq("id", data.studyId);
    return { ok: true as const };
  });


const RevertInput = z.object({ auditId: z.string().uuid() });
export const revertTuning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevertInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("auto_odds_tuning_audit")
      .select("id, user_id, param, prev_value, reverted_at")
      .eq("id", data.auditId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!row) return { ok: false as const, error: "audit row not found" };
    if (row.reverted_at) return { ok: false as const, error: "already reverted" };
    await supabaseAdmin.from("auto_odds_settings").update({ [row.param]: row.prev_value } as any).eq("user_id", context.userId);
    await supabaseAdmin.from("auto_odds_tuning_audit").update({ reverted_at: new Date().toISOString() }).eq("id", data.auditId);
    return { ok: true as const };
  });

export const setAutoApplyStudies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("auto_odds_settings")
      .update({ auto_apply_studies: data.enabled })
      .eq("user_id", context.userId);
    return { ok: true as const };
  });

export const listTuningAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("auto_odds_tuning_audit")
      .select("id, param, prev_value, new_value, rationale, confidence, source, reverted_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    return { rows: data ?? [] };
  });
