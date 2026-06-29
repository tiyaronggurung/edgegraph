// Backfill outcomes for closed predictions, so CLV / model-accuracy can be scored later.
// Walks prediction_closes rows with outcome IS NULL, fetches the final match snapshot
// via the active provider, derives YES/NO per market, and updates the row.
// Called daily via pg_cron.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { getProvider } from "@/lib/providers";
import type { LiveMatchSnapshot } from "@/lib/providers/liveProvider";

const provider = getProvider();

function deriveOutcome(
  snap: LiveMatchSnapshot,
  market: string,
  pick: string,
  line: number | null,
): boolean | null {
  const h = snap.goalsHome;
  const a = snap.goalsAway;
  const total = h + a;
  const totalCorners = (snap.home.corners ?? 0) + (snap.away.corners ?? 0);

  switch (market) {
    case "1X2":
      if (pick === "HOME") return h > a;
      if (pick === "AWAY") return a > h;
      if (pick === "DRAW") return h === a;
      return null;
    case "BTTS":
      if (pick === "YES") return h > 0 && a > 0;
      if (pick === "NO") return !(h > 0 && a > 0);
      return null;
    case "GOALS": {
      if (line == null) return null;
      if (pick === "OVER") return total > line;
      if (pick === "UNDER") return total < line;
      return null;
    }
    case "CORNERS": {
      if (line == null) return null;
      if (pick === "OVER") return totalCorners > line;
      if (pick === "UNDER") return totalCorners < line;
      return null;
    }
    // NEXT_GOAL outcome can't be derived from final score alone — skip.
    case "NEXT_GOAL":
    default:
      return null;
  }
}

export const Route = createFileRoute("/api/public/hooks/backfill-outcomes")({
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
        if (!url || !serviceKey) return new Response("Server not configured", { status: 500 });

        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const started = Date.now();

        // Find fixtures with at least one outcome=null close row.
        const { data: pending, error } = await admin
          .from("prediction_closes")
          .select("fixture_id")
          .is("outcome", null)
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const uniqueFixtures = Array.from(new Set((pending ?? []).map((r) => r.fixture_id as string)));
        let updated = 0;
        let failed = 0;

        for (const fixtureId of uniqueFixtures.slice(0, 50)) {
          try {
            const snap = await provider.fetchMatch(fixtureId);
            if (!snap) continue;
            // Get all closed rows for this fixture
            const { data: rows } = await admin
              .from("prediction_closes")
              .select("id, market, pick, line")
              .eq("fixture_id", fixtureId)
              .is("outcome", null);
            for (const r of rows ?? []) {
              const o = deriveOutcome(
                snap,
                r.market as string,
                r.pick as string,
                (r.line as number | null) ?? null,
              );
              if (o == null) continue;
              await admin.from("prediction_closes").update({ outcome: o }).eq("id", r.id);
              updated++;
            }
          } catch (e) {
            failed++;
            console.warn("backfill failed for fixture", fixtureId, e);
          }
        }

        return Response.json({
          fixturesChecked: uniqueFixtures.length,
          rowsUpdated: updated,
          failed,
          ms: Date.now() - started,
        });
      },
    },
  },
});
