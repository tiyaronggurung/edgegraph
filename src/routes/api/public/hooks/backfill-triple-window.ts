// Cron: fetch Kalshi's authoritative settlement for closed-but-unscored
// triple-window shadow rows. Called by pg_cron every 5 min. Complements the
// client-side final flush in useTripleWindowTracker (which only runs while a
// user has the crypto page open).
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";
import { fetchKalshiSettlement } from "@/lib/kalshiSettle";

export const Route = createFileRoute("/api/public/hooks/backfill-triple-window")({
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
        const cutoff = Date.now() - 30_000; // must be closed for ≥30s

        const { data: rows, error } = await admin
          .from("btc_polymarket_triple_window")
          .select("kalshi_ticker, market_close_ms")
          .is("actual_outcome", null)
          .lt("market_close_ms", cutoff)
          .order("market_close_ms", { ascending: false })
          .limit(50);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let settled = 0;
        let pending = 0;
        let failed = 0;
        for (const r of rows ?? []) {
          try {
            const s = await fetchKalshiSettlement(r.kalshi_ticker);
            if (!s || !s.finalized || !s.result) { pending++; continue; }
            const { error: upErr } = await admin
              .from("btc_polymarket_triple_window")
              .update({
                actual_outcome: s.result.toUpperCase(),
                expiration_value: s.expirationValue,
                settled_at: new Date().toISOString(),
              })
              .eq("kalshi_ticker", r.kalshi_ticker);
            if (upErr) { failed++; continue; }
            settled++;
          } catch {
            failed++;
          }
        }

        return Response.json({
          checked: (rows ?? []).length,
          settled, pending, failed,
          ms: Date.now() - started,
        });
      },
    },
  },
});
