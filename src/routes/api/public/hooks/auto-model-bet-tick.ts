import { createFileRoute } from "@tanstack/react-router";

// Server-side cron: fires the Model Bet auto-trade for every opted-in user
// every minute, 24/7 — independent of whether their browser tab is open or
// their web session has expired. Mirrors the browser auto-fire path but
// stays flat $10 / skipLadder (matches the standing stake rule).
//
// Opt-in gate: auto_odds_settings.enabled = true AND auto_button_type = 'model_bet'.
// Odds Bet users, disabled users, and users without Kalshi creds are skipped.
// One user's failure never kills the loop.

export const Route = createFileRoute("/api/public/hooks/auto-model-bet-tick")({
  server: {
    handlers: {
      POST: async () => {
        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutoTradeCore } = await import("@/lib/cryptoAutoTrade.functions");

        // Opted-in users only.
        const { data: settingsRows, error: settingsErr } = await supabaseAdmin
          .from("auto_odds_settings")
          .select("user_id")
          .eq("enabled", true)
          .eq("auto_button_type", "model_bet");
        if (settingsErr) {
          return Response.json({ ok: false, error: settingsErr.message }, { status: 500 });
        }
        const userIds = (settingsRows ?? []).map((r) => r.user_id).filter(Boolean);
        if (userIds.length === 0) {
          return Response.json({ ok: true, userCount: 0, results: [], durationMs: Date.now() - t0 });
        }

        // Must have Kalshi creds on profile.
        const { data: creds, error: credsErr } = await supabaseAdmin
          .from("profiles")
          .select("id, kalshi_api_key_id, kalshi_private_key_pem")
          .in("id", userIds);
        if (credsErr) {
          return Response.json({ ok: false, error: credsErr.message }, { status: 500 });
        }
        const usersWithCreds = (creds ?? []).filter(
          (p) => (p.kalshi_api_key_id ?? "").trim() && (p.kalshi_private_key_pem ?? "").trim(),
        );

        const tapeCutoff = new Date(Date.now() - 120_000).toISOString();
        const results: Array<{ userId: string; placed: number; skipped: number; error?: string }> = [];

        for (const u of usersWithCreds) {
          try {
            // Skip idle users (no fresh tape in last 2 min) to avoid pointless work.
            const { data: tape } = await supabaseAdmin
              .from("btc_odds_tape")
              .select("snapped_at")
              .eq("user_id", u.id)
              .gte("snapped_at", tapeCutoff)
              .limit(1);
            if (!tape || tape.length === 0) continue;

            const res = await runAutoTradeCore(supabaseAdmin as never, u.id, {
              mode: "live",
              stakeUsd: 10,
              confirm: "I_UNDERSTAND_LIVE",
              skipLadder: true,
              force: false,
              isMartingale: false,
              forceTicker: undefined,
              forceSide: undefined,
              maxEntryCents: undefined,
              maxOrders: 5,
            });
            results.push({
              userId: u.id,
              placed: res.placed ?? 0,
              skipped: res.skipped ?? 0,
            });
          } catch (e) {
            const msg = (e as Error)?.message ?? String(e);
            console.error("[auto-model-bet-tick] user", u.id, msg);
            results.push({ userId: u.id, placed: 0, skipped: 0, error: msg });
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
