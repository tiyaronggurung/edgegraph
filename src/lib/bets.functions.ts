import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SaveBetSchema = z.object({
  game: z.string().min(1).max(255),
  pick: z.string().min(1).max(255),
  sport: z.string().min(1).max(64),
  odds: z.number().min(0).max(1).optional(),
  pattern_type: z.string().max(64).optional(),
  confidence_score: z.number().min(0).max(100).optional(),
  edge_score: z.number().min(-100).max(100).optional(),
  stake: z.number().min(0).max(1_000_000).optional(),
  notes: z.string().max(2000).optional(),
});

export const saveBetFromMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveBetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Link to user's latest analysis (if any).
    const { data: latest } = await supabase
      .from("analyses")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: bet, error } = await supabase
      .from("bets")
      .insert({
        user_id: userId,
        analysis_id: latest?.id ?? null,
        game: data.game,
        pick: data.pick,
        sport: data.sport,
        odds: data.odds ?? null,
        pattern_type: data.pattern_type ?? null,
        confidence_score: data.confidence_score ?? null,
        edge_score: data.edge_score ?? null,
        notes: data.notes ?? null,
        result: "Pending",
        stake: data.stake ?? 0,
      })
      .select("id, analysis_id")
      .single();

    if (error) throw new Error(error.message);
    return { ok: true, betId: bet.id, linkedAnalysisId: bet.analysis_id };
  });
