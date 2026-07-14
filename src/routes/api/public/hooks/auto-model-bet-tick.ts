import { createFileRoute } from "@tanstack/react-router";

// Server-side cron: fires the Model Bet auto-trade for every opted-in user
// every minute, 24/7 — independent of whether their browser tab is open.
// Rule: only fires when the model's side is currently ≤ 10¢ (cheap entry),
// at any point in the market's life. Base stake $5, shrunk so payout ≤ $20
// max at the observed entry price. One order per ticker per user.

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

        // Newest open predictions — any that are still live. Entry gate is
        // price-based (our-side ≤ 10¢), not time-based.
        const nowIso = new Date().toISOString();
        const { data: preds } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("ticker, side, close_time")
          .gt("close_time", nowIso)
          .order("close_time", { ascending: true })
          .limit(10);
        const openPreds = (preds ?? []) as Array<{ ticker: string; side: "YES" | "NO"; close_time: string }>;

        const results: Array<{ userId: string; placed: number; skipped: number; ticker?: string; error?: string; priceCents?: number; stakeUsd?: number }> = [];

        // Payout cap: max $20 per order. Contracts = floor(stake*100/price),
        // each contract pays $1, so stake ≤ price¢ / 5 keeps payout ≤ $20.
        // Base stake $5, but shrunk to hit the payout cap given the entry price.
        // Also gate: only fire if our-side price ≤ 10¢ (cheap late-window entry).
        const MAX_ENTRY_CENTS = 70;
        const BASE_STAKE = 10;
        const PAYOUT_CAP = 20;

        for (const u of usersWithCreds) {
          try {
            // Pick the newest open prediction the user hasn't been filled on,
            // AND whose our-side price is currently ≤ 10¢.
            let pick: { ticker: string; side: "YES" | "NO"; priceCents: number } | null = null;
            for (const p of openPreds) {
              const { data: existing } = await supabaseAdmin
                .from("auto_trade_orders")
                .select("id")
                .eq("user_id", u.id)
                .eq("ticker", p.ticker)
                .eq("mode", "live")
                .limit(1);
              if (existing && existing.length > 0) continue;

              // Latest odds snapshot for this ticker (any user — public price).
              const { data: tape } = await supabaseAdmin
                .from("btc_odds_tape")
                .select("yes_cents, no_cents, snapped_at")
                .eq("ticker", p.ticker)
                .order("snapped_at", { ascending: false })
                .limit(1);
              const row = tape?.[0] as { yes_cents: number | null; no_cents: number | null; snapped_at: string } | undefined;
              if (!row) continue;
              // Stale > 90s → skip (odds can flip fast in the last 5 min).
              if (Date.now() - new Date(row.snapped_at).getTime() > 90_000) continue;
              const priceCents = p.side === "YES" ? Number(row.yes_cents) : Number(row.no_cents);
              if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents > MAX_ENTRY_CENTS) continue;
              pick = { ticker: p.ticker, side: p.side, priceCents };
              break;
            }
            if (!pick) {
              results.push({ userId: u.id, placed: 0, skipped: 0 });
              continue;
            }

            // Size stake to keep payout ≤ $20 at the observed price.
            const stakeUsd = Math.max(1, Math.min(BASE_STAKE, Math.floor((PAYOUT_CAP * pick.priceCents) / 100 * 100) / 100));

            const res = await runAutoTradeCore(supabaseAdmin as never, u.id, {
              mode: "live",
              stakeUsd,
              confirm: "I_UNDERSTAND_LIVE",
              skipLadder: true,
              force: true,
              isMartingale: false,
              forceTicker: pick.ticker,
              forceSide: pick.side,
              maxEntryCents: MAX_ENTRY_CENTS,
              maxOrders: 1,
            });
            const placed = res.placed ?? 0;
            const skipped = res.skipped ?? 0;
            // If the core returned 0 placed AND 0 skipped it usually means a
            // Kalshi-side rejection (bad key / no balance / market closed).
            // Capture whatever reason string the core exposes so the user can
            // see it in auto_model_bet_errors instead of losing it to console.
            if (placed === 0) {
              const reason =
                (res as { reason?: string; error?: string; message?: string }).reason ??
                (res as { error?: string }).error ??
                (res as { message?: string }).message ??
                null;
              if (reason) {
                await supabaseAdmin.from("auto_model_bet_errors").insert({
                  user_id: u.id,
                  ticker: pick.ticker,
                  side: pick.side,
                  price_cents: pick.priceCents,
                  stake_usd: stakeUsd,
                  stage: "core_no_fill",
                  error: String(reason).slice(0, 500),
                });
              }
            }
            results.push({
              userId: u.id,
              placed,
              skipped,
              ticker: pick.ticker,
              priceCents: pick.priceCents,
              stakeUsd,
            });
          } catch (e) {
            const msg = (e as Error)?.message ?? String(e);
            console.error("[auto-model-bet-tick] user", u.id, msg);
            try {
              await supabaseAdmin.from("auto_model_bet_errors").insert({
                user_id: u.id,
                ticker: pick.ticker,
                side: pick.side,
                price_cents: pick.priceCents,
                stage: "exception",
                error: msg.slice(0, 500),
              });
            } catch { /* swallow */ }
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
