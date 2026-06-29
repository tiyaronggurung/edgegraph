import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TeamStatsSchema = z.object({
  shots: z.number().nullable(),
  shotsOnTarget: z.number().nullable(),
  possession: z.number().nullable(),
  corners: z.number().nullable(),
  fouls: z.number().nullable(),
  attacks: z.number().nullable(),
  dangerousAttacks: z.number().nullable(),
  yellowCards: z.number().nullable(),
  redCards: z.number().nullable(),
  expectedGoals: z.number().nullable(),
});

const InputSchema = z.object({
  homeTeam: z.string().min(1).max(80),
  awayTeam: z.string().min(1).max(80),
  league: z.string().max(80).optional().default(""),
  elapsed: z.number().int().min(0).max(130).nullable(),
  status: z.string().max(10),
  goalsHome: z.number().int().min(0),
  goalsAway: z.number().int().min(0),
  home: TeamStatsSchema,
  away: TeamStatsSchema,
  // Optional market context (Kalshi 3-way fair %)
  marketHome: z.number().min(0).max(100).optional().nullable(),
  marketDraw: z.number().min(0).max(100).optional().nullable(),
  marketAway: z.number().min(0).max(100).optional().nullable(),
});

export type SoccerPropsInput = z.infer<typeof InputSchema>;

export interface PropPick {
  pick: string; // e.g. "YES", "NO", "OVER", "UNDER"
  confidencePct: number; // 0-100
  reasoning: string; // 1-2 sentences
}

export interface SoccerPropsResult {
  btts: PropPick;
  totalGoals: PropPick & { line: number };
  totalCorners: PropPick & { line: number };
  momentum: "Home" | "Away" | "Even";
  keyFactors: string[];
  summary: string;
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "emit_soccer_props",
    description: "Return structured 80%+ confidence predictions for BTTS, total goals, and total corners.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        btts: {
          type: "object",
          additionalProperties: false,
          properties: {
            pick: { type: "string", enum: ["YES", "NO"] },
            confidencePct: { type: "number", minimum: 0, maximum: 100 },
            reasoning: { type: "string" },
          },
          required: ["pick", "confidencePct", "reasoning"],
        },
        totalGoals: {
          type: "object",
          additionalProperties: false,
          properties: {
            line: { type: "number", description: "Goal line, typically 2.5" },
            pick: { type: "string", enum: ["OVER", "UNDER"] },
            confidencePct: { type: "number", minimum: 0, maximum: 100 },
            reasoning: { type: "string" },
          },
          required: ["line", "pick", "confidencePct", "reasoning"],
        },
        totalCorners: {
          type: "object",
          additionalProperties: false,
          properties: {
            line: { type: "number", description: "Corner line for match total, e.g. 9.5" },
            pick: { type: "string", enum: ["OVER", "UNDER"] },
            confidencePct: { type: "number", minimum: 0, maximum: 100 },
            reasoning: { type: "string" },
          },
          required: ["line", "pick", "confidencePct", "reasoning"],
        },
        momentum: { type: "string", enum: ["Home", "Away", "Even"] },
        keyFactors: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: { type: "string" },
        },
        summary: { type: "string" },
      },
      required: ["btts", "totalGoals", "totalCorners", "momentum", "keyFactors", "summary"],
    },
  },
};

function buildPrompt(d: SoccerPropsInput): string {
  const elapsed = d.elapsed ?? 0;
  const minsLeft = Math.max(0, 90 - elapsed);
  const totalGoals = d.goalsHome + d.goalsAway;
  const totalCorners = (d.home.corners ?? 0) + (d.away.corners ?? 0);
  const totalShots = (d.home.shots ?? 0) + (d.away.shots ?? 0);
  const totalSoT = (d.home.shotsOnTarget ?? 0) + (d.away.shotsOnTarget ?? 0);
  const totalDA = (d.home.dangerousAttacks ?? 0) + (d.away.dangerousAttacks ?? 0);

  return [
    `Match: ${d.homeTeam} vs ${d.awayTeam} (${d.league})`,
    `Status: ${d.status} · Elapsed: ${elapsed}' · ${minsLeft}' remaining`,
    `Score: ${d.homeTeam} ${d.goalsHome} - ${d.goalsAway} ${d.awayTeam} (total ${totalGoals} goals)`,
    "",
    `LIVE STATS (Home | Away):`,
    `  Shots: ${d.home.shots ?? "?"} | ${d.away.shots ?? "?"} (total ${totalShots})`,
    `  Shots on Target: ${d.home.shotsOnTarget ?? "?"} | ${d.away.shotsOnTarget ?? "?"} (total ${totalSoT})`,
    `  Possession: ${d.home.possession ?? "?"}% | ${d.away.possession ?? "?"}%`,
    `  Corners: ${d.home.corners ?? 0} | ${d.away.corners ?? 0} (total ${totalCorners})`,
    `  Fouls: ${d.home.fouls ?? "?"} | ${d.away.fouls ?? "?"}`,
    `  Attacks: ${d.home.attacks ?? "?"} | ${d.away.attacks ?? "?"}`,
    `  Dangerous Attacks: ${d.home.dangerousAttacks ?? "?"} | ${d.away.dangerousAttacks ?? "?"} (total ${totalDA})`,
    `  xG: ${d.home.expectedGoals ?? "?"} | ${d.away.expectedGoals ?? "?"}`,
    `  Cards: ${d.home.yellowCards ?? 0}Y/${d.home.redCards ?? 0}R | ${d.away.yellowCards ?? 0}Y/${d.away.redCards ?? 0}R`,
    d.marketHome != null
      ? `\nKalshi market (fair %): ${d.homeTeam} ${d.marketHome.toFixed(0)}% / Draw ${(d.marketDraw ?? 0).toFixed(0)}% / ${d.awayTeam} ${d.marketAway?.toFixed(0)}%`
      : "",
    "",
    "TASK: Predict three props with confidence (0-100):",
    "1. BTTS (Both Teams To Score) — YES/NO",
    "2. Total Goals Over/Under (pick line 2.5 by default, or 1.5 if late and 0-0)",
    "3. Total Corners Over/Under (line 9.5 by default; scale by pace)",
    "",
    "RULES:",
    "- Weigh momentum (recent attacks/dangerous attacks), shots on target rate, time remaining, score state, possession, fouls/cards (red card = open game).",
    "- For BTTS: if both teams already scored, YES at 99%. If late (>75') and a team has 0 shots on target, NO leans strong.",
    "- For goals: extrapolate xG / current pace × time remaining. Stalled games stay UNDER.",
    "- For corners: extrapolate current corner pace to 90'. Account for trailing team pushing for goals.",
    "- Be decisive. Only return confidence ≥ 80% when stats strongly support it; otherwise return your honest read (e.g. 55-70%).",
    "- keyFactors: 3-5 bullets citing specific stats.",
    "- summary: 1-2 sentences, sharp and quantitative.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const predictSoccerProps = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ result: SoccerPropsResult | null; error: string | null }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { result: null, error: "LOVABLE_API_KEY not configured" };

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are EdgeGraph's elite soccer prop analyst. You weigh live match stats — shots on target, dangerous attacks, possession, corners pace, fouls, cards, score state, time remaining, and momentum — to call BTTS, total goals, and total corners with quantitative reasoning. Return ONE call to emit_soccer_props. Be decisive, never refuse.",
            },
            { role: "user", content: buildPrompt(data) },
          ],
          tools: [TOOL],
          tool_choice: { type: "function", function: { name: "emit_soccer_props" } },
        }),
      });

      if (res.status === 429) return { result: null, error: "Rate limited — try again in a minute." };
      if (res.status === 402)
        return { result: null, error: "AI credits exhausted. Add credits in Workspace settings." };
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("predictSoccerProps gateway error", res.status, t);
        return { result: null, error: `AI gateway error (${res.status})` };
      }

      const json = await res.json();
      const call = json?.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      if (!args) return { result: null, error: "No structured output from model" };
      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      return { result: parsed as SoccerPropsResult, error: null };
    } catch (e) {
      console.error("predictSoccerProps failed", e);
      return { result: null, error: e instanceof Error ? e.message : "Unknown error" };
    }
  });
