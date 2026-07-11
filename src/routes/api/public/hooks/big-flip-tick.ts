import { createFileRoute } from "@tanstack/react-router";

// Server-side cron: runs the big-flip detector + live $10 auto-buy for every
// user with Kalshi creds set and recent tape activity. Fires 24/7 regardless
// of whether the browser is open. Public route — no auth header required
// (cron calls it with the anon apikey; verification is by shared design of
// the /api/public prefix).

export const Route = createFileRoute("/api/public/hooks/big-flip-tick")({
  server: {
    handlers: {
      POST: async () => {
        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runBigFlipForUser } = await import("@/lib/bigFlipDetector.functions");

        // Users with Kalshi creds set.
        const { data: users, error: usersErr } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .not("kalshi_api_key_id", "is", null)
          .not("kalshi_private_key_pem", "is", null);
        if (usersErr) {
          return Response.json({ ok: false, error: usersErr.message }, { status: 500 });
        }

        // Filter to users with recent tape (last 2 min) to avoid pointless work.
        const cutoff = new Date(Date.now() - 120_000).toISOString();
        const results: Array<{ userId: string; ticker: string | null; passed: boolean; reject: string | null }> = [];
        for (const u of users ?? []) {
          const { data: tape } = await supabaseAdmin
            .from("btc_odds_tape")
            .select("snapped_at")
            .eq("user_id", u.id)
            .gte("snapped_at", cutoff)
            .limit(1);
          if (!tape || tape.length === 0) continue;

          try {
            const sig = await runBigFlipForUser(supabaseAdmin, u.id);
            results.push({
              userId: u.id,
              ticker: sig.ticker,
              passed: sig.passed,
              reject: sig.rejectReason,
            });
          } catch (e) {
            console.error("[big-flip-tick] user", u.id, (e as Error)?.message);
          }
        }

        return Response.json({
          ok: true,
          durationMs: Date.now() - t0,
          userCount: results.length,
          results,
        });
      },
    },
  },
});
