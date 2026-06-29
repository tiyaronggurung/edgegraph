// Shared background worker: recomputes ensemble predictions for every live
// fixture and persists snapshots + history. Called by pg_cron every minute.
// Public route (auth bypass) — guards with anon apikey header per Lovable convention.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { ApiFootballProvider } from "@/lib/providers/apiFootballProvider";
import { computeStatsModel } from "@/lib/models/poissonSoccer";

// Reuse the AI adjuster + ensemble logic from the engine module by re-implementing
// the small pure helpers here to avoid pulling a server fn into a route worker.
import type { LiveMatchSnapshot } from "@/lib/providers/liveProvider";
import type { StatsModelResult } from "@/lib/models/poissonSoccer";

const provider = new ApiFootballProvider();

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

async function callAi(
  snap: LiveMatchSnapshot,
  stats: StatsModelResult,
): Promise<AiOutput | null> {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processFixture(admin: any, fixtureId: string) {
  const snap = await provider.fetchMatch(fixtureId);
  if (!snap) return { fixtureId, skipped: true };
  const stats = computeStatsModel(snap);
  const ai = await callAi(snap, stats);
  const markets = applyEnsemble(stats, ai);
  const explanation = ai
    ? {
        momentum: ai.momentum,
        summary: ai.summary,
        keyFactors: ai.keyFactors,
        changes: ai.adjustments
          .filter((a) => Math.abs(a.deltaPct) >= 3)
          .map((a) => {
            const sign = a.deltaPct >= 0 ? "+" : "";
            const lineStr = a.line != null ? ` ${a.line}` : "";
            return `${a.market} ${a.pick}${lineStr}: ${sign}${a.deltaPct.toFixed(0)}pp — ${a.reason}`;
          }),
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

  return { fixtureId: snap.fixtureId, ok: true };
}

export const Route = createFileRoute("/api/public/hooks/recompute-predictions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey");
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

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
