// Public read-only access to worker-produced predictions.
// UI reads from these instead of triggering AI on every client open.

import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { MatchPrediction } from "@/lib/predictionEngine.functions";

function publicClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export const listStoredLiveFixtures = createServerFn({ method: "GET" }).handler(
  async () => {
    const sb = publicClient();
    const { data, error } = await sb
      .from("live_predictions")
      .select("fixture_id, home_team, away_team, league, status, elapsed, goals_home, goals_away, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return { matches: [], error: error.message };
    return {
      matches: (data ?? []).map((m) => ({
        fixtureId: m.fixture_id as string,
        homeTeam: m.home_team as string,
        awayTeam: m.away_team as string,
        league: (m.league as string) ?? "",
        status: (m.status as string) ?? "",
        elapsed: m.elapsed as number | null,
        goalsHome: m.goals_home as number,
        goalsAway: m.goals_away as number,
      })),
      error: null as string | null,
    };
  },
);

export const getStoredPrediction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fixtureId: z.string().min(1) }).parse(d))
  .handler(async ({ data }): Promise<{ prediction: MatchPrediction | null; error: string | null }> => {
    const sb = publicClient();
    const { data: row, error } = await sb
      .from("live_predictions")
      .select("*")
      .eq("fixture_id", data.fixtureId)
      .maybeSingle();
    if (error) return { prediction: null, error: error.message };
    if (!row) return { prediction: null, error: "Not yet computed — worker runs every minute" };
    return {
      prediction: {
        fixtureId: row.fixture_id,
        providerId: row.provider_id,
        league: row.league ?? "",
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        status: row.status ?? "",
        elapsed: row.elapsed,
        goalsHome: row.goals_home,
        goalsAway: row.goals_away,
        snapshot: row.snapshot,
        stats: row.stats,
        markets: row.markets,
        explanation: row.explanation,
        computedAt: new Date(row.computed_at).getTime(),
      },
      error: null,
    };
  });
