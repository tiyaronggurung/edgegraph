// Cron-triggered auto-trade hook. Public endpoint; pg_cron calls every minute.
// For each user, places at most 1 paper bet per call ($10, ≥1σ + momentum)
// up to a lifetime cap of 5 orders, then only settles. No auth header needed
// (this prefix bypasses published-site auth — we still validate apikey).
import { createFileRoute } from "@tanstack/react-router";
import { getBtcMarkets } from "@/lib/cryptoBtc.functions";

const LIFETIME_CAP = 5;
const STAKE_USD = 50;
const MIN_SIGMA = 1.0;

export const Route = createFileRoute("/api/public/hooks/auto-trade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1) Fetch market snapshot once (shared across users). Tolerate Kalshi 429s.
        let markets;
        try {
          markets = await getBtcMarkets();
        } catch (e) {
          return Response.json({ ok: false, skipped: "markets fetch failed", error: String(e) }, { status: 200 });
        }

        // 2) Iterate every profile and (a) settle (b) place if under cap.
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id");

        let totalPlaced = 0, totalSettled = 0;
        const perUser: Array<{ userId: string; placed: number; settled: number; reason?: string }> = [];

        for (const p of (profiles ?? []) as Array<{ id: string }>) {
          const userId = p.id;
          let placed = 0, settled = 0, reason: string | undefined;

          // ---- Settle any due paper orders for this user ----
          const { data: due } = await supabaseAdmin
            .from("auto_trade_orders")
            .select("id, ticker, side, strike, contracts, limit_cents")
            .eq("user_id", userId)
            .eq("status", "placed")
            .lt("close_time", new Date().toISOString())
            .limit(50);
          const pending = (due ?? []) as Array<{ id: string; ticker: string; side: "YES" | "NO"; strike: number; contracts: number; limit_cents: number }>;
          if (pending.length) {
            const tickers = [...new Set(pending.map(o => o.ticker))];
            const { data: closes } = await supabaseAdmin
              .from("btc_model_predictions")
              .select("ticker, settle_price")
              .in("ticker", tickers)
              .not("settle_price", "is", null);
            const priceByTicker = new Map<string, number>(
              ((closes ?? []) as Array<{ ticker: string; settle_price: number | null }>)
                .filter(c => c.settle_price !== null)
                .map(c => [c.ticker, Number(c.settle_price)]),
            );
            for (const o of pending) {
              const px = priceByTicker.get(o.ticker);
              if (px === undefined) continue;
              const won = o.side === "YES" ? px >= Number(o.strike) : px < Number(o.strike);
              const pnl = won
                ? ((100 - o.limit_cents) / 100) * o.contracts
                : -(o.limit_cents / 100) * o.contracts;
              const { error } = await supabaseAdmin
                .from("auto_trade_orders")
                .update({
                  status: won ? "settled_win" : "settled_loss",
                  settle_price: px,
                  pnl_usd: pnl,
                  settled_at: new Date().toISOString(),
                })
                .eq("id", o.id);
              if (!error) settled++;
            }
          }

          // ---- Lifetime cap: don't place new orders past 5 ----
          const { count } = await supabaseAdmin
            .from("auto_trade_orders")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);
          if ((count ?? 0) >= LIFETIME_CAP) {
            reason = "lifetime cap reached";
            perUser.push({ userId, placed, settled, reason });
            totalSettled += settled;
            continue;
          }

          // ---- Avoid duplicate ticker in last 24h (prevents same-window double bet) ----
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: recentRows } = await supabaseAdmin
            .from("auto_trade_orders")
            .select("ticker")
            .eq("user_id", userId)
            .gte("created_at", since);
          const recentTickers = new Set((recentRows ?? []).map((r: { ticker: string }) => r.ticker));

          // ---- Pick best eligible market: BET + ≥1σ + momentum aligned + ≥90s ----
          const candidate = markets.markets
            .filter(m =>
              m.gateAction === "BET" &&
              m.sigmaDistance >= MIN_SIGMA &&
              m.gapAnalysis.momentumAlignsWithSide &&
              m.secondsToClose >= 90 &&
              !recentTickers.has(m.ticker)
            )
            .sort((a, b) => (b.edgeAbs - b.requiredEdgePts) - (a.edgeAbs - a.requiredEdgePts))[0];

          if (!candidate) {
            reason = "no eligible market";
            perUser.push({ userId, placed, settled, reason });
            totalSettled += settled;
            continue;
          }

          const m = candidate;
          const limitCents = Math.max(1, Math.min(99, Math.round(
            (m.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice))) * 100,
          )));
          const contracts = Math.max(1, Math.floor((STAKE_USD * 100) / limitCents));
          const stakeActual = (contracts * limitCents) / 100;

          const { error: insertErr } = await supabaseAdmin
            .from("auto_trade_orders")
            .insert({
              user_id: userId,
              session_id: crypto.randomUUID(),
              mode: "paper",
              ticker: m.ticker,
              event_ticker: m.eventTicker,
              side: m.side,
              stake_usd: stakeActual,
              limit_cents: limitCents,
              contracts,
              strike: m.strike,
              spot_at_entry: m.spot,
              model_prob: m.modelYesProb,
              market_yes_price: m.yesPrice,
              edge_pts: m.edgePts,
              sigma_distance: m.sigmaDistance,
              gap_in_sigmas: m.gapAnalysis.gapInSigmas,
              seconds_to_close: m.secondsToClose,
              close_time: m.closeTime ?? new Date(Date.now() + m.secondsToClose * 1000).toISOString(),
              status: "placed",
            });
          if (insertErr) {
            reason = `insert error: ${insertErr.message}`;
          } else {
            placed++;
          }

          totalPlaced += placed;
          totalSettled += settled;
          perUser.push({ userId, placed, settled, reason });
        }

        return Response.json({
          ok: true,
          totalPlaced,
          totalSettled,
          users: perUser.length,
          perUser: perUser.slice(0, 50),
          ts: new Date().toISOString(),
        });
      },
    },
  },
});
