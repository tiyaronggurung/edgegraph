import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { planStake, applySettlement, resetSession, isNewUtcDay, type RecoveryState } from "@/lib/martingaleRecovery";

// Public cron endpoint — Martingale Recovery auto trader.
// Fires shadow bets on Kalshi BTC 15m ATM markets when Kalshi's favored side
// is 70-80¢ AND the model's latest prediction agrees. Sizes each next bet to
// partially recover any current deficit across up to 3 wins.
// Uses service-role admin client. Guard: apikey header must match anon key.

interface TapeRow {
  ticker: string;
  strike: number;
  spot: number;
  yes_cents: number;
  no_cents: number;
  seconds_to_close: number;
  snapped_at: string;
}

export const Route = createFileRoute("/api/public/hooks/martingale-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = await verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. Load all enabled martingale users.
        const { data: activeUsers, error: uErr } = await supabaseAdmin
          .from("martingale_recovery_state")
          .select("*")
          .eq("enabled", true);
        if (uErr) return new Response(JSON.stringify({ error: uErr.message }), { status: 500 });

        let firedTotal = 0, settledTotal = 0, skippedTotal = 0;

        for (const row of activeUsers ?? []) {
          let state = row as RecoveryState & { user_id: string };
          const userId = state.user_id;

          // 2. Roll session on new UTC day.
          if (isNewUtcDay(state.session_started_at)) {
            const rolled = resetSession(state);
            await supabaseAdmin
              .from("martingale_recovery_state")
              .update({
                session_loss_usd: 0,
                consec_recovery_losses: 0,
                session_started_at: rolled.session_started_at,
                stopped_reason: null,
              })
              .eq("user_id", userId);
            state = { ...state, ...rolled };
          }

          if (state.stopped_reason || !state.enabled) continue;

          // 3. Settle open martingale shadows first.
          const { data: openRows } = await supabaseAdmin
            .from("auto_trade_odds_shadow")
            .select("id, ticker, side, contracts, limit_cents")
            .eq("user_id", userId)
            .eq("trigger", "martingale_recovery")
            .eq("settled", false);

          for (const s of openRows ?? []) {
            const { data: latestTape } = await supabaseAdmin
              .from("btc_odds_tape")
              .select("yes_cents, no_cents, seconds_to_close, snapped_at")
              .eq("user_id", userId)
              .eq("ticker", s.ticker as string)
              .order("snapped_at", { ascending: false })
              .limit(1);
            const t = latestTape?.[0];
            if (!t) continue;
            if (Number(t.seconds_to_close) > 0) continue;
            const yesWon = Number(t.yes_cents) >= 50;
            const sideWon = s.side === "YES" ? yesWon : !yesWon;
            const contracts = Number(s.contracts);
            const limit = Number(s.limit_cents);
            const pnl = sideWon
              ? (contracts * (100 - limit)) / 100
              : -(contracts * limit) / 100;
            const { error: uErr2 } = await supabaseAdmin
              .from("auto_trade_odds_shadow")
              .update({
                settled: true, won: sideWon, pnl_usd: pnl,
                final_yes_cents: t.yes_cents,
                settled_at: new Date().toISOString(),
              })
              .eq("id", s.id);
            if (!uErr2) {
              settledTotal++;
              state = applySettlement(state, pnl) as typeof state;
              await supabaseAdmin
                .from("martingale_recovery_state")
                .update({
                  deficit_usd: state.deficit_usd,
                  initial_deficit_usd: state.initial_deficit_usd,
                  recovery_wins_completed: state.recovery_wins_completed,
                  consec_recovery_losses: state.consec_recovery_losses,
                  session_loss_usd: state.session_loss_usd,
                  stopped_reason: state.stopped_reason,
                  enabled: state.enabled,
                })
                .eq("user_id", userId);
              if (state.stopped_reason || !state.enabled) break;
            }
          }
          if (state.stopped_reason || !state.enabled) continue;

          // 4. Look for a fire opportunity: ATM market, favored 70-80¢, model agrees.
          const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
          const { data: tape } = await supabaseAdmin
            .from("btc_odds_tape")
            .select("ticker, strike, spot, yes_cents, no_cents, seconds_to_close, snapped_at")
            .eq("user_id", userId)
            .gte("snapped_at", cutoff)
            .order("snapped_at", { ascending: false });
          if (!tape || tape.length === 0) continue;

          // Latest snapshot per ticker
          const byTicker = new Map<string, TapeRow>();
          for (const r of tape as TapeRow[]) {
            if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, r);
          }

          // Already-open positions block re-entry on same ticker.
          const { data: openTix } = await supabaseAdmin
            .from("auto_trade_odds_shadow")
            .select("ticker")
            .eq("user_id", userId)
            .eq("trigger", "martingale_recovery")
            .eq("settled", false);
          const openSet = new Set((openTix ?? []).map(r => r.ticker as string));

          for (const [ticker, snap] of byTicker) {
            if (openSet.has(ticker)) continue;
            if (snap.seconds_to_close < 60 || snap.seconds_to_close > 900) continue;

            const yes = Number(snap.yes_cents);
            const no = Number(snap.no_cents);
            const favoredSide: "YES" | "NO" = yes >= no ? "YES" : "NO";
            const favoredCents = favoredSide === "YES" ? yes : no;

            // Must fit 70-80¢
            if (favoredCents < 70 || favoredCents > 80) continue;

            // Model agreement check — latest prediction for this ticker.
            const { data: preds } = await supabaseAdmin
              .from("btc_model_predictions")
              .select("side")
              .eq("ticker", ticker)
              .order("created_at", { ascending: false })
              .limit(1);
            const modelSide = preds?.[0]?.side as string | undefined;
            if (!modelSide || modelSide !== favoredSide) continue;

            const plan = planStake(state, favoredCents);
            if (!plan) continue;

            const { error: insErr, data: ins } = await supabaseAdmin
              .from("auto_trade_odds_shadow")
              .insert({
                user_id: userId,
                ticker,
                strike: snap.strike,
                side: favoredSide,
                trigger: "martingale_recovery",
                seconds_to_close_at_fire: snap.seconds_to_close,
                yes_cents_at_fire: yes,
                no_cents_at_fire: no,
                limit_cents: plan.limitCents,
                contracts: plan.contracts,
                stake_usd: plan.stakeUsd,
                flip_count_at_fire: 0,
                spot_at_fire: snap.spot,
                entry_velocity_cents: 0,
              })
              .select("id")
              .single();
            if (!insErr && ins) {
              firedTotal++;
              await supabaseAdmin
                .from("martingale_recovery_state")
                .update({ last_shadow_id: ins.id })
                .eq("user_id", userId);
              break; // one fire per user per tick
            } else {
              skippedTotal++;
            }
          }
        }

        return new Response(JSON.stringify({
          ok: true,
          users: (activeUsers ?? []).length,
          fired: firedTotal,
          settled: settledTotal,
          skipped: skippedTotal,
        }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
