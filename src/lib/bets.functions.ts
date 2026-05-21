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

export const getBankrollStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: prof }, { data: bets }] = await Promise.all([
      supabase.from("profiles").select("bankroll").maybeSingle(),
      supabase.from("bets").select("stake, profit_loss, result"),
    ]);
    const bankroll = Number(prof?.bankroll ?? 1000);
    let openStake = 0;
    let realized = 0;
    let openCount = 0;
    let settledCount = 0;
    for (const b of bets ?? []) {
      const stake = Number(b.stake ?? 0);
      const pl = Number(b.profit_loss ?? 0);
      const result = String(b.result ?? "Pending");
      if (result === "Pending") {
        openStake += stake;
        openCount += 1;
      } else {
        realized += pl;
        settledCount += 1;
      }
    }
    return { bankroll, openStake, openCount, realized, settledCount };
  });

/**
 * CLV (Closing Line Value) capture.
 * For decimal odds: clv% = (entry_odds / closing_odds - 1) * 100
 * Positive CLV = locked a better price than close — best long-run +EV signal.
 */
const CaptureClosingSchema = z.object({
  betId: z.string().uuid(),
  closingOdds: z.number().min(1.01).max(1000),
});

export const captureClosingLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CaptureClosingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: bet, error: fetchErr } = await supabase
      .from("bets")
      .select("id, odds, user_id")
      .eq("id", data.betId)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!bet || bet.user_id !== userId) throw new Error("Bet not found");
    const entry = Number(bet.odds ?? 0);
    if (!entry || entry < 1.01) throw new Error("Entry odds missing or invalid");
    const clv = (entry / data.closingOdds - 1) * 100;
    const { error: updErr } = await supabase
      .from("bets")
      .update({
        closing_odds: data.closingOdds,
        closing_captured_at: new Date().toISOString(),
        clv_percent: clv,
      })
      .eq("id", data.betId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, clvPercent: clv };
  });

export const getClvStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: bets } = await supabase
      .from("bets")
      .select("id, clv_percent")
      .not("clv_percent", "is", null);
    const rows = bets ?? [];
    if (!rows.length) return { avgClv: 0, captured: 0, positiveRate: 0 };
    const sum = rows.reduce((s, b) => s + Number(b.clv_percent ?? 0), 0);
    const pos = rows.filter((b) => Number(b.clv_percent ?? 0) > 0).length;
    return {
      avgClv: sum / rows.length,
      captured: rows.length,
      positiveRate: (pos / rows.length) * 100,
    };
  });


