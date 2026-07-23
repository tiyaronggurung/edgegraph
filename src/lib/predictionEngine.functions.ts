// Ensemble prediction engine.
// Orchestrates: LiveDataProvider → statistical Poisson model → AI narrative & adjustment.
// Provider-agnostic by design; swap providers without touching this file's contract.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getProvider } from "@/lib/providers";
import type {
  LiveDataProvider,
  LiveMatchSnapshot,
} from "@/lib/providers/liveProvider";
import { computeStatsModel, type StatsModelResult } from "@/lib/models/poissonSoccer";

// Provider selected by LIVE_PROVIDER env var (default: api-football).
const provider: LiveDataProvider = getProvider();

export interface PredictionMarket {
  market: string;
  pick: string;
  probability: number; // 0..1 (ensemble)
  statsProb: number;
  aiProb: number | null;
  confidence: number; // 0..100
  line?: number;
}

export interface PredictionExplanation {
  momentum: "Home" | "Away" | "Even";
  summary: string;
  keyFactors: string[];
  changes: string[]; // e.g. "BTTS +12% after 4 shots on target in 8 minutes"
}

export interface MatchPrediction {
  fixtureId: string;
  providerId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  elapsed: number | null;
  goalsHome: number;
  goalsAway: number;
  snapshot: LiveMatchSnapshot;
  stats: StatsModelResult;
  markets: PredictionMarket[];
  explanation: PredictionExplanation | null;
  computedAt: number;
}

const Input = z.object({
  fixtureId: z.string().min(1),
  includeAi: z.boolean().optional().default(true),
});

const AI_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_adjustments",
    description:
      "Adjust the statistical baseline probabilities using narrative judgement (momentum, late-game pressure, intangibles). Return small adjustments (-15..+15 percentage points). Most should be 0 if the stats already reflect reality.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        momentum: { type: "string", enum: ["Home", "Away", "Even"] },
        adjustments: {
          type: "array",
          description: "Each entry adjusts one market pick.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              market: { type: "string", description: "1X2 | BTTS | NEXT_GOAL | GOALS | CORNERS" },
              pick: { type: "string", description: "e.g. HOME, DRAW, AWAY, YES, NO, OVER, UNDER, NONE" },
              line: { type: "number" },
              deltaPct: { type: "number", description: "Adjustment in percentage points, -15..+15" },
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
};

function buildAiPrompt(snap: LiveMatchSnapshot, stats: StatsModelResult): string {
  const totalShots = (snap.home.shots ?? 0) + (snap.away.shots ?? 0);
  const totalSoT = (snap.home.shotsOnTarget ?? 0) + (snap.away.shotsOnTarget ?? 0);
  const totalDA = (snap.home.dangerousAttacks ?? 0) + (snap.away.dangerousAttacks ?? 0);
  const totalCorners = (snap.home.corners ?? 0) + (snap.away.corners ?? 0);
  const recent = snap.events
    .slice(-6)
    .map((e) => `${e.minute}' ${e.team} ${e.type} ${e.detail}`)
    .join(" | ");

  return [
    `Match: ${snap.homeTeam} vs ${snap.awayTeam} (${snap.league})`,
    `${snap.status} · ${snap.elapsed ?? 0}'${snap.injuryTime ? `+${snap.injuryTime}` : ""} · Score ${snap.goalsHome}-${snap.goalsAway}`,
    "",
    `LIVE STATS (H|A):`,
    `  Shots ${snap.home.shots ?? "?"}|${snap.away.shots ?? "?"} (${totalShots}t)`,
    `  On Target ${snap.home.shotsOnTarget ?? "?"}|${snap.away.shotsOnTarget ?? "?"} (${totalSoT}t)`,
    `  Possession ${snap.home.possession ?? "?"}%|${snap.away.possession ?? "?"}%`,
    `  Corners ${snap.home.corners ?? 0}|${snap.away.corners ?? 0} (${totalCorners}t)`,
    `  Dangerous Attacks ${snap.home.dangerousAttacks ?? "?"}|${snap.away.dangerousAttacks ?? "?"} (${totalDA}t)`,
    `  Fouls ${snap.home.fouls ?? "?"}|${snap.away.fouls ?? "?"}`,
    `  Cards ${snap.home.yellowCards ?? 0}Y/${snap.home.redCards ?? 0}R | ${snap.away.yellowCards ?? 0}Y/${snap.away.redCards ?? 0}R`,
    `  xG ${snap.home.expectedGoals ?? "?"}|${snap.away.expectedGoals ?? "?"}`,
    `  Offsides ${snap.home.offsides ?? "?"}|${snap.away.offsides ?? "?"}`,
    recent ? `Recent events: ${recent}` : "",
    "",
    "STATISTICAL BASELINE (Poisson model):",
    `  1X2: Home ${(stats.winHome * 100).toFixed(0)}% / Draw ${(stats.draw * 100).toFixed(0)}% / Away ${(stats.winAway * 100).toFixed(0)}%`,
    `  BTTS YES: ${(stats.btts * 100).toFixed(0)}%`,
    `  Next Goal: H ${(stats.nextGoalHome * 100).toFixed(0)}% / A ${(stats.nextGoalAway * 100).toFixed(0)}% / NONE ${(stats.nextGoalNone * 100).toFixed(0)}%`,
    `  O 2.5: ${(stats.overGoals["2.5"] * 100).toFixed(0)}% · O 3.5: ${(stats.overGoals["3.5"] * 100).toFixed(0)}%`,
    `  Corners O 9.5: ${(stats.overCorners.over * 100).toFixed(0)}%`,
    "",
    "TASK: Read momentum and game state. Return small narrative-driven ADJUSTMENTS (deltaPct between -15 and +15) to the baseline. If the stats already capture reality, return adjustments=[]. Cite specific stats in `reason`. Be honest, decisive, no disclaimers.",
  ]
    .filter(Boolean)
    .join("\n");
}

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

async function callAi(snap: LiveMatchSnapshot, stats: StatsModelResult): Promise<AiOutput | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are EdgeGraph's narrative adjuster. The statistical baseline is already strong. Your job is to make small adjustments based on momentum, leverage, and intangibles the model cannot see. Return ONE call to emit_adjustments.",
          },
          { role: "user", content: buildAiPrompt(snap, stats) },
        ],
        tools: [AI_TOOL],
        tool_choice: { type: "function", function: { name: "emit_adjustments" } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    return typeof args === "string" ? JSON.parse(args) : args;
  } catch (e) {
    console.warn("ai adjuster failed", e);
    return null;
  }
}

function applyEnsemble(
  stats: StatsModelResult,
  ai: AiOutput | null,
): PredictionMarket[] {
  const aiMap = new Map<string, AiAdjustment>();
  for (const adj of ai?.adjustments ?? []) {
    const key = `${adj.market}|${adj.pick}|${adj.line ?? ""}`;
    aiMap.set(key, adj);
  }

  return stats.markets.map((m) => {
    const key = `${m.market}|${m.pick}|${m.line ?? ""}`;
    const adj = aiMap.get(key);
    const statsProb = m.probability;
    let ensemble = statsProb;
    let aiProb: number | null = null;
    if (adj) {
      const aiDelta = Math.max(-0.15, Math.min(0.15, (adj.deltaPct ?? 0) / 100));
      aiProb = Math.max(0, Math.min(1, statsProb + aiDelta));
      // 70% stats / 30% AI weight on the adjusted value
      ensemble = 0.7 * statsProb + 0.3 * aiProb;
    }
    // Confidence: distance from 50/50, scaled
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

export const predictMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{ prediction: MatchPrediction | null; error: string | null }> => {
    try {
      const snap = await provider.fetchMatch(data.fixtureId);
      if (!snap) return { prediction: null, error: "Match not currently live on provider" };

      const stats = computeStatsModel(snap);
      const ai = data.includeAi ? await callAi(snap, stats) : null;
      const markets = applyEnsemble(stats, ai);

      const explanation: PredictionExplanation | null = ai
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

      return {
        prediction: {
          fixtureId: snap.fixtureId,
          providerId: snap.providerId,
          league: snap.league,
          homeTeam: snap.homeTeam,
          awayTeam: snap.awayTeam,
          status: snap.status,
          elapsed: snap.elapsed,
          goalsHome: snap.goalsHome,
          goalsAway: snap.goalsAway,
          snapshot: snap,
          stats,
          markets,
          explanation,
          computedAt: Date.now(),
        },
        error: null,
      };
    } catch (e) {
      console.error("predictMatch failed", e);
      return { prediction: null, error: e instanceof Error ? e.message : "Unknown" };
    }
  });

// Lightweight list of live fixtures (no per-match stats round-trips).
export const listLiveFixtures = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const matches = await provider.fetchLive();
    return {
      matches: matches.map((m) => ({
        fixtureId: m.fixtureId,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        league: m.league,
        status: m.status,
        elapsed: m.elapsed,
        goalsHome: m.goalsHome,
        goalsAway: m.goalsAway,
      })),
      error: null as string | null,
    };
  } catch (e) {
    return {
      matches: [],
      error: e instanceof Error ? e.message : "Unknown",
    };
  }
});
