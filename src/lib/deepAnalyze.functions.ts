import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  sport: z.string().min(1).max(40),
  teamA: z.string().min(1).max(80),
  teamB: z.string().min(1).max(80),
  score: z.string().max(40).optional().nullable(),
  timePeriod: z.string().max(40).optional().nullable(),
  probabilityA: z.number().min(0).max(100),
  probabilityB: z.number().min(0).max(100),
  // 3-way soccer support: when present, probabilityA + probabilityDraw +
  // probabilityB should sum to ~100, and the model is told it's a 3-way market.
  probabilityDraw: z.number().min(0).max(100).optional().nullable(),
  marketType: z.enum(["2way", "3way"]).optional().nullable(),
  pattern: z.string().max(60).optional().nullable(),
  volume: z.number().min(0).optional().nullable(),
  lastPlay: z.string().max(400).optional().nullable(),
  series: z.array(z.number().min(0).max(100)).min(2).max(400),
});

export type DeepAnalyzeInput = z.infer<typeof InputSchema>;

export interface DeepAnalyzeResult {
  pattern: string;
  momentum: "Up A" | "Up B" | "Flat";
  volatility: "Calm" | "Choppy" | "Panic";
  action: "Bet A" | "Bet B" | "Bet Draw" | "Hedge" | "Wait" | "Avoid";
  confidence: number; // 0-100
  narrative: string;
  next_moves: { prob: number; target: string; why: string }[];
  risks: string[];
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "emit_deep_analysis",
    description: "Return a structured deep analysis of the live probability market.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        pattern: {
          type: "string",
          description:
            "One of: Momentum Shift, Mean-Reversion Squeeze, Trend Exhaustion, Sharp Footprint, Chaotic Coin Flip, Controlled Stability, Breakaway Trend, Dominant Lock, V-Reversal, Fake Spike, Public Overreaction, Late Momentum Swing.",
        },
        momentum: { type: "string", enum: ["Up A", "Up B", "Flat"] },
        volatility: { type: "string", enum: ["Calm", "Choppy", "Panic"] },
        action: { type: "string", enum: ["Bet A", "Bet B", "Bet Draw", "Hedge", "Wait", "Avoid"] },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        narrative: {
          type: "string",
          description: "2-4 sentence plain-English read of the chart + game context.",
        },
        next_moves: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              prob: { type: "number", minimum: 0, maximum: 100, description: "Probability this scenario plays out (0-100)." },
              target: { type: "string", description: "Where probability likely goes, e.g. 'A climbs to 65-70%'." },
              why: { type: "string", description: "One sentence cause." },
            },
            required: ["prob", "target", "why"],
          },
        },
        risks: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "string" },
        },
      },
      required: ["pattern", "momentum", "volatility", "action", "confidence", "narrative", "next_moves", "risks"],
    },
  },
};

function buildPrompt(d: DeepAnalyzeInput): string {
  const tail = d.series.slice(-12).map((n) => n.toFixed(1)).join(", ");
  const first = d.series[0].toFixed(1);
  const last = d.series[d.series.length - 1].toFixed(1);
  const min = Math.min(...d.series).toFixed(1);
  const max = Math.max(...d.series).toFixed(1);
  return [
    `Sport: ${d.sport}`,
    `Matchup: ${d.teamA} vs ${d.teamB}`,
    d.score ? `Score: ${d.score}` : null,
    d.timePeriod ? `Time/period: ${d.timePeriod}` : null,
    d.marketType === "3way"
      ? `Market type: 3-way (Team A win / Draw / Team B win). Current market: ${d.teamA} ${d.probabilityA.toFixed(1)}% / Draw ${(d.probabilityDraw ?? 0).toFixed(1)}% / ${d.teamB} ${d.probabilityB.toFixed(1)}%`
      : `Current market probability: ${d.teamA} ${d.probabilityA.toFixed(1)}% / ${d.teamB} ${d.probabilityB.toFixed(1)}%`,
    `Probability series for ${d.teamA} (oldest→newest, ${d.series.length} samples): start ${first}, min ${min}, max ${max}, end ${last}. Tail: [${tail}].`,
    d.pattern ? `Engine-classified pattern: ${d.pattern}` : null,
    d.volume != null ? `Market volume: $${Math.round(d.volume).toLocaleString()}` : null,
    d.lastPlay ? `Last play / context: ${d.lastPlay}` : null,
    "",
    d.marketType === "3way"
      ? "Classify the pattern, momentum, and volatility regime. Predict 2-4 next-move scenarios with probabilities that sum to ~100. Recommend an action (Bet A / Bet Draw / Bet B / Hedge / Wait / Avoid). In soccer, Draw is a real outcome — consider it explicitly when score is level and game is past the 70th minute, or when both sides are evenly matched. Be specific about why — cite the slope, volatility, and game-state leverage. Do NOT hedge with disclaimers; give a clear read."
      : "Classify the pattern, momentum, and volatility regime. Predict 2-4 next-move scenarios with probabilities that sum to ~100. Recommend an action (Bet A / Bet B / Hedge / Wait / Avoid). Be specific about why — cite the slope, volatility, and game-state leverage. Do NOT hedge with disclaimers; give a clear read.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const deepAnalyze = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ result: DeepAnalyzeResult | null; error: string | null }> => {
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
                "You are EdgeGraph's deep pattern analyst for live betting markets. You read probability charts and game state, then return ONE call to the emit_deep_analysis tool. Be direct, quantitative, and decisive. Never refuse.",
            },
            { role: "user", content: buildPrompt(data) },
          ],
          tools: [TOOL],
          tool_choice: { type: "function", function: { name: "emit_deep_analysis" } },
        }),
      });

      if (res.status === 429) return { result: null, error: "Rate limited — try again in a minute." };
      if (res.status === 402) return { result: null, error: "AI credits exhausted. Add credits in Workspace settings." };
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("deepAnalyze gateway error", res.status, t);
        return { result: null, error: `AI gateway error (${res.status})` };
      }

      const json = await res.json();
      const call = json?.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      if (!args) return { result: null, error: "No structured output from model" };

      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      return { result: parsed as DeepAnalyzeResult, error: null };
    } catch (e) {
      console.error("deepAnalyze failed", e);
      return { result: null, error: e instanceof Error ? e.message : "Unknown error" };
    }
  });
