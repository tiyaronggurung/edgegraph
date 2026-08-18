// Shared background worker: recomputes ensemble predictions for every live
// fixture and persists snapshots + history. Called by pg_cron every minute.
// Public route (auth bypass) — guards with anon apikey header per Lovable convention.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";
import { getProvider } from "@/lib/providers";
import { computeStatsModel } from "@/lib/models/poissonSoccer";

import type { LiveMatchSnapshot } from "@/lib/providers/liveProvider";
import type { StatsModelResult } from "@/lib/models/poissonSoccer";

const provider = getProvider();

interface AiAdjustment {
  market: string;
  pick: string;
  line?: number;
  deltaPct: number;
  reason: string;
}
interface AiOutput {
  momentum: "Home" | "Away" | "Even";
  adjustments: AiAdjustment[];
  summary: string;
  keyFactors: string[];
}

// On-demand AI gate: Gemini is only called when a user action explicitly
// requests it (body { ai: true } or header x-ai-ondemand: 1). Cron/background
// ticks run the stats model only — no AI spend.
let aiAllowedForRequest = false;

async function callAi(
  snap: LiveMatchSnapshot,
  stats: StatsModelResult,
): Promise<AiOutput | null> {
  if (!aiAllowedForRequest) return null;
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;

  try {
    const totalSoT = (snap.home.shotsOnTarget ?? 0) + (snap.away.shotsOnTarget ?? 0);
    const recent = snap.events
      .slice(-6)
      .map((e) => `${e.minute}' ${e.team} ${e.type} ${e.detail}`)
      .join(" | ");
    const prompt = [
      `Match: ${snap.homeTeam} vs ${snap.awayTeam} (${snap.league})`,
      `${snap.status} · ${snap.elapsed ?? 0}' · Score ${snap.goalsHome}-${snap.goalsAway}`,
      `Shots H|A ${snap.home.shots ?? "?"}|${snap.away.shots ?? "?"} · SoT ${snap.home.shotsOnTarget ?? "?"}|${snap.away.shotsOnTarget ?? "?"} (${totalSoT})`,
      `Poss ${snap.home.possession ?? "?"}|${snap.away.possession ?? "?"} · xG ${snap.home.expectedGoals ?? "?"}|${snap.away.expectedGoals ?? "?"}`,
      `Corners ${snap.home.corners ?? 0}|${snap.away.corners ?? 0} · Cards ${snap.home.redCards ?? 0}R|${snap.away.redCards ?? 0}R`,
      recent ? `Recent: ${recent}` : "",
      `Baseline 1X2 ${(stats.winHome * 100).toFixed(0)}/${(stats.draw * 100).toFixed(0)}/${(stats.winAway * 100).toFixed(0)} · BTTS ${(stats.btts * 100).toFixed(0)} · O2.5 ${(stats.overGoals["2.5"] * 100).toFixed(0)}`,
      `Return narrative deltaPct (-15..+15) only where momentum/intangibles diverge from stats.`,
    ]
      .filter(Boolean)
      .join("\n");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "EdgeGraph narrative adjuster. Output ONE call to emit_adjustments. Be decisive.",
          },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_adjustments",
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  momentum: { type: "string", enum: ["Home", "Away", "Even"] },
                  adjustments: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        market: { type: "string" },
                        pick: { type: "string" },
                        line: { type: "number" },
                        deltaPct: { type: "number" },
                        reason: { type: "string" },
                      },
                      required: ["market", "pick", "deltaPct", "reason"],
                    },
                  },
                  summary: { type: "string" },
                  keyFactors: { type: "array", items: { type: "string" } },
                },
                required: ["momentum", "adjustments", "summary", "keyFactors"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_adjustments" } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    return typeof args === "string" ? JSON.parse(args) : args;
  } catch (e) {
    console.warn("worker ai failed", e);
    return null;
  }
}

function applyEnsemble(stats: StatsModelResult, ai: AiOutput | null) {
  const aiMap = new Map<string, AiAdjustment>();
  for (const adj of ai?.adjustments ?? []) {
    aiMap.set(`${adj.market}|${adj.pick}|${adj.line ?? ""}`, adj);
  }
  return stats.markets.map((m) => {
    const adj = aiMap.get(`${m.market}|${m.pick}|${m.line ?? ""}`);
    const statsProb = m.probability;
    let ensemble = statsProb;
    let aiProb: number | null = null;
    if (adj) {
      const aiDelta = Math.max(-0.15, Math.min(0.15, (adj.deltaPct ?? 0) / 100));
      aiProb = Math.max(0, Math.min(1, statsProb + aiDelta));
      ensemble = 0.7 * statsProb + 0.3 * aiProb;
    }
    const conf = Math.round(Math.abs(ensemble - 0.5) * 200);
    return {
      market: m.market,
      pick: m.pick,
      line: m.line,
      probability: Math.max(0, Math.min(1, ensemble)),
      statsProb,
      aiProb,
      confidence: Math.max(0, Math.min(100, conf)),
    };
  });
}

interface MarketRow {
  market: string;
  pick: string;
  line?: number | null;
  probability: number;
  statsProb: number;
  aiProb: number | null;
}

function keyOf(m: { market: string; pick: string; line?: number | null }) {
  return `${m.market}|${m.pick}|${m.line ?? ""}`;
}

function labelOf(m: { market: string; pick: string; line?: number | null }) {
  if (m.market === "1X2") return `1X2 ${m.pick}`;
  if (m.market === "BTTS") return `BTTS ${m.pick}`;
  if (m.market === "NEXT_GOAL") return `Next Goal ${m.pick}`;
  if (m.market === "GOALS") return `O/U ${m.line} ${m.pick}`;
  if (m.market === "CORNERS") return `Corners ${m.pick} ${m.line}`;
  return `${m.market} ${m.pick}`;
}

function describeRecentEvents(snap: LiveMatchSnapshot, sincePrevElapsed: number): string {
  const fresh = snap.events.filter((e) => (e.minute ?? 0) > sincePrevElapsed);
  if (!fresh.length) return "";
  const parts: string[] = [];
  const goals = fresh.filter((e) => e.type === "Goal");
  const reds = fresh.filter((e) => e.type === "Card" && /red/i.test(e.detail));
  const subs = fresh.filter((e) => e.type === "subst");
  const var_ = fresh.filter((e) => e.type === "Var");
  if (goals.length) parts.push(`${goals.length} goal${goals.length > 1 ? "s" : ""}`);
  if (reds.length) parts.push(`${reds.length} red card`);
  if (var_.length) parts.push("VAR review");
  if (subs.length >= 2) parts.push("subs");
  return parts.join(", ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processFixture(admin: any, fixtureId: string) {
  const snap = await provider.fetchMatch(fixtureId);
  if (!snap) return { fixtureId, skipped: true };
  const stats = computeStatsModel(snap);
  const ai = await callAi(snap, stats);
  const markets = applyEnsemble(stats, ai);

  // Fetch previous row to compute movement deltas.
  const { data: prev } = await admin
    .from("live_predictions")
    .select("markets, elapsed")
    .eq("fixture_id", snap.fixtureId)
    .maybeSingle();

  const prevMap = new Map<string, MarketRow>();
  if (prev?.markets && Array.isArray(prev.markets)) {
    for (const m of prev.markets as MarketRow[]) prevMap.set(keyOf(m), m);
  }
  const prevElapsed = (prev?.elapsed as number | null) ?? 0;
  const sinceEvents = describeRecentEvents(snap, prevElapsed);

  // Generate stat-driven delta narration (no AI call — free, deterministic).
  const movementChanges: string[] = [];
  for (const m of markets) {
    const before = prevMap.get(keyOf(m));
    if (!before) continue;
    const deltaPp = (m.probability - before.probability) * 100;
    if (Math.abs(deltaPp) < 5) continue;
    const sign = deltaPp >= 0 ? "+" : "";
    const tail = sinceEvents ? ` after ${sinceEvents}` : "";
    movementChanges.push(`${labelOf(m)}: ${sign}${deltaPp.toFixed(0)}pp${tail}`);
  }

  const aiChanges = ai
    ? ai.adjustments
        .filter((a) => Math.abs(a.deltaPct) >= 3)
        .map((a) => {
          const sign = a.deltaPct >= 0 ? "+" : "";
          const lineStr = a.line != null ? ` ${a.line}` : "";
          return `${a.market} ${a.pick}${lineStr}: ${sign}${a.deltaPct.toFixed(0)}pp — ${a.reason}`;
        })
    : [];

  const explanation = ai
    ? {
        momentum: ai.momentum,
        summary: ai.summary,
        keyFactors: ai.keyFactors,
        changes: [...movementChanges.slice(0, 5), ...aiChanges].slice(0, 8),
      }
    : movementChanges.length
    ? {
        momentum: "Even" as const,
        summary: sinceEvents ? `Movement after ${sinceEvents}.` : "Stats-only update.",
        keyFactors: [] as string[],
        changes: movementChanges.slice(0, 8),
      }
    : null;

  const now = new Date().toISOString();
  await admin.from("live_predictions").upsert({
    fixture_id: snap.fixtureId,
    provider_id: snap.providerId,
    league: snap.league,
    home_team: snap.homeTeam,
    away_team: snap.awayTeam,
    status: snap.status,
    elapsed: snap.elapsed,
    goals_home: snap.goalsHome,
    goals_away: snap.goalsAway,
    snapshot: snap,
    stats,
    markets,
    explanation,
    computed_at: now,
    updated_at: now,
  });

  // Persist key markets to history (for charts + deltas).
  const keyMarkets = markets.filter(
    (m) =>
      m.market === "1X2" ||
      (m.market === "BTTS" && m.pick === "YES") ||
      (m.market === "GOALS" && m.line === 2.5 && m.pick === "OVER") ||
      m.market === "NEXT_GOAL",
  );
  if (keyMarkets.length) {
    await admin.from("prediction_history").insert(
      keyMarkets.map((m) => ({
        fixture_id: snap.fixtureId,
        market: m.market,
        pick: m.pick,
        line: m.line ?? null,
        probability: m.probability,
        stats_prob: m.statsProb,
        ai_prob: m.aiProb,
        computed_at: now,
      })),
    );
  }

  // CLV snapshot: when the match closes (FT/AET/PEN), freeze the final ensemble
  // for every market so we can later score model accuracy & compute CLV vs market.
  const finalStatuses = new Set(["FT", "AET", "PEN", "ended", "closed", "Finished"]);
  if (finalStatuses.has(snap.status)) {
    await admin.from("prediction_closes").upsert(
      markets.map((m) => ({
        fixture_id: snap.fixtureId,
        market: m.market,
        pick: m.pick,
        line: m.line ?? null,
        ensemble_prob: m.probability,
        stats_prob: m.statsProb,
        ai_prob: m.aiProb,
        market_prob: null,
        outcome: null,
        closed_at: now,
      })),
      { onConflict: "fixture_id,market,pick,line" },
    );
  }

  return { fixtureId: snap.fixtureId, ok: true };
}


export const Route = createFileRoute("/api/public/hooks/recompute-predictions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = await verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey");
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Only user-triggered calls may spend AI credits.
        let body: any = null;
        try { body = await request.clone().json(); } catch { body = null; }
        aiAllowedForRequest =
          body?.ai === true || request.headers.get("x-ai-ondemand") === "1";

        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          return new Response("Server not configured", { status: 500 });
        }

        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const started = Date.now();
        let live: Awaited<ReturnType<typeof provider.fetchLive>> = [];
        try {
          live = await provider.fetchLive();
        } catch (e) {
          console.error("worker fetchLive failed", e);
          return Response.json({ error: "fetchLive failed" }, { status: 502 });
        }

        // Cap to avoid runaway cost — 25 live matches max per tick.
        const targets = live.slice(0, 25);

        // Parallel but bounded; AI Gateway handles concurrency fine at this scale.
        const results = await Promise.allSettled(
          targets.map((m) => processFixture(admin, m.fixtureId)),
        );

        // Garbage-collect fixtures that finished > 2h ago.
        await admin
          .from("live_predictions")
          .delete()
          .lt("updated_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

        return Response.json({
          processed: results.filter((r) => r.status === "fulfilled").length,
          failed: results.filter((r) => r.status === "rejected").length,
          total: targets.length,
          ms: Date.now() - started,
        });
      },
    },
  },
});
