// Server function: detect Kalshi-style probability graph from a screenshot.
// Uses Lovable AI Gateway (vision + tool calling) for structured extraction.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface KalshiDetection {
  sport: "NBA" | "NFL" | "NHL" | "MLB" | "Tennis" | "Soccer" | "Other";
  league: string;
  gameName: string;
  teamA: string;
  teamB: string;
  probabilityA: number;
  probabilityB: number;
  oddsA: number;
  oddsB: number;
  volume: number;
  score: string;
  timePeriod: string;
  shape:
    | "Dominant Lock"
    | "Controlled Stability"
    | "Breakaway Trend"
    | "Late Momentum Swing"
    | "V-Reversal"
    | "Fake Spike"
    | "Chaotic Coin Flip"
    | "Momentum Exhaustion"
    | "Sharp Money Recovery"
    | "Volatility Compression"
    | "Public Overreaction"
    | "Failed Rally"
    | "Favorite Confirmation"
    | "Underdog Trap"
    | "Late-Game Stability";
  momentum: "Up" | "Down" | "Flat";
  volatility: "Low" | "Medium" | "High";
  marketNote: string;
  confidence: number; // 0-1 model self-rated confidence
}

const SYSTEM = `You are a sports betting graph analyst. The user uploads a screenshot from the Kalshi app showing a live probability chart for a sports event.

Extract every field you can read directly from the image (team names, score, period, leading probability, volume, etc.). For values not visible, use a sensible default ("" for strings, 0 for numbers).

For the "shape" field, classify the visible probability curve into ONE of these patterns:
- Dominant Lock: one side stays >90% the whole way, almost flat at the top
- Controlled Stability: clear favorite (75-90%) with low volatility
- Breakaway Trend: starts near 50/50 then steadily breaks toward one side
- Late Momentum Swing: stable then sharp move in the last portion of the chart
- V-Reversal: dips down then recovers (or spikes up then recovers down to a V)
- Fake Spike: sharp spike upward then collapses back
- Chaotic Coin Flip: heavy oscillation around 50%, no clear winner
- Momentum Exhaustion: reaches a peak then slowly fades
- Sharp Money Recovery: dips early then recovers strongly
- Volatility Compression: erratic early, then tightens
- Public Overreaction: huge move on one event, then partial retracement
- Failed Rally: attempts to rally but each peak is lower
- Favorite Confirmation: gradual confirmation of the pre-game favorite
- Underdog Trap: underdog briefly leads then collapses
- Late-Game Stability: settles flat in the final stretch above 80%

Always call the function — never reply in plain text.`;

export const detectKalshiGraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { imageDataUrl: string }) => {
    if (!input?.imageDataUrl || !input.imageDataUrl.startsWith("data:image/")) {
      throw new Error("imageDataUrl must be a data: URL of an image");
    }
    if (input.imageDataUrl.length > 8_000_000) {
      throw new Error("Image too large (max ~6MB). Please use a smaller screenshot.");
    }
    return input;
  })
  .handler(async ({ data }): Promise<KalshiDetection> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const tool = {
      type: "function" as const,
      function: {
        name: "report_kalshi_graph",
        description: "Return the structured analysis of a Kalshi probability graph.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sport: { type: "string", enum: ["NBA", "NFL", "NHL", "MLB", "Tennis", "Soccer", "Other"] },
            league: { type: "string" },
            gameName: { type: "string" },
            teamA: { type: "string" },
            teamB: { type: "string" },
            probabilityA: { type: "number", minimum: 0, maximum: 100 },
            probabilityB: { type: "number", minimum: 0, maximum: 100 },
            oddsA: { type: "number", minimum: 0 },
            oddsB: { type: "number", minimum: 0 },
            volume: { type: "number", minimum: 0 },
            score: { type: "string" },
            timePeriod: { type: "string" },
            shape: {
              type: "string",
              enum: [
                "Dominant Lock", "Controlled Stability", "Breakaway Trend", "Late Momentum Swing",
                "V-Reversal", "Fake Spike", "Chaotic Coin Flip", "Momentum Exhaustion",
                "Sharp Money Recovery", "Volatility Compression", "Public Overreaction",
                "Failed Rally", "Favorite Confirmation", "Underdog Trap", "Late-Game Stability",
              ],
            },
            momentum: { type: "string", enum: ["Up", "Down", "Flat"] },
            volatility: { type: "string", enum: ["Low", "Medium", "High"] },
            marketNote: { type: "string", description: "One-sentence summary of the visible market move." },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "sport", "league", "gameName", "teamA", "teamB",
            "probabilityA", "probabilityB", "oddsA", "oddsB", "volume",
            "score", "timePeriod", "shape", "momentum", "volatility",
            "marketNote", "confidence",
          ],
        },
      },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Detect this Kalshi probability graph and call the function." },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "report_kalshi_graph" } },
      }),
    });

    if (res.status === 429) throw new Error("Rate limit hit — please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add funds in Lovable workspace settings.");
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI gateway error [${res.status}]: ${txt.slice(0, 300)}`);
    }

    const payload = await res.json();
    const call = payload?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      throw new Error("Model did not return a structured detection.");
    }
    const parsed = JSON.parse(call.function.arguments) as KalshiDetection;
    return parsed;
  });
