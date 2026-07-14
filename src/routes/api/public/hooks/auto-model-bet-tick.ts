import { createFileRoute } from "@tanstack/react-router";

// Server-side cron: fires the Model Bet auto-trade for every opted-in user
// every minute, 24/7 — independent of whether their browser tab is open.
// Mirrors the browser Model Bet panel: force-fires on the newest open
// prediction's value-pick side, bypassing the standard confidence/sigzone
// gates. Flat $10 stake, one order per ticker per user, 75¢ entry cap.

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

        // Newest open predictions — only fire in the final 5 minutes before close.
        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const windowEndIso = new Date(now + 5 * 60 * 1000).toISOString();
        const { data: preds } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("ticker, side, close_time")
          .gt("close_time", nowIso)
          .lte("close_time", windowEndIso)
          .order("close_time", { ascending: true })
          .limit(5);
        const openPreds = (preds ?? []) as Array<{ ticker: string; side: "YES" | "NO"; close_time: string }>;

        const results: Array<{ userId: string; placed: number; skipped: number; ticker?: string; error?: string }> = [];

        for (const u of usersWithCreds) {
          try {
            // Pick the newest open prediction the user hasn't already been filled on (live).
            let pick: { ticker: string; side: "YES" | "NO" } | null = null;
            for (const p of openPreds) {
              const { data: existing } = await supabaseAdmin
                .from("auto_trade_orders")
                .select("id")
                .eq("user_id", u.id)
                .eq("ticker", p.ticker)
                .eq("mode", "live")
                .limit(1);
              if (!existing || existing.length === 0) {
                pick = { ticker: p.ticker, side: p.side };
                break;
              }
            }
            if (!pick) {
              results.push({ userId: u.id, placed: 0, skipped: 0 });
              continue;
            }

            const res = await runAutoTradeCore(supabaseAdmin as never, u.id, {
              mode: "live",
              stakeUsd: 10,
              confirm: "I_UNDERSTAND_LIVE",
              skipLadder: true,
              force: true,
              isMartingale: false,
              forceTicker: pick.ticker,
              forceSide: pick.side,
              maxEntryCents: 75,
              maxOrders: 1,
            });
            results.push({
              userId: u.id,
              placed: res.placed ?? 0,
              skipped: res.skipped ?? 0,
              ticker: pick.ticker,
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
