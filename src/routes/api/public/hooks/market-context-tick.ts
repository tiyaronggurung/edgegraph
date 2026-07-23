// Market Context cron endpoint. Runs every minute.
// For each active Kalshi BTC hourly ticker (observed in the last 2 min),
// determines the current checkpoint stage from seconds_to_close and writes
// a snapshot to btc_market_context. Also writes a 'fire' checkpoint for any
// order created in the last 90s that lacks one. All writes are idempotent
// via UNIQUE (ticker, checkpoint_type).
//
// Shadow-only. Nothing here reads or blocks trading logic.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { writeMarketContext, type CheckpointType } from "@/lib/marketContext/computeAndWrite.server";

function checkpointForSecondsToClose(s: number): CheckpointType | null {
  if (s >= 780 && s <= 900) return "first_valid";
  if (s >= 540 && s <= 660) return "t_minus_10";
  if (s >= 240 && s <= 360) return "t_minus_5";
  if (s >= 60 && s <= 180) return "t_minus_2";
  if (s >= 0 && s < 60) return "final";
  return null;
}

export const Route = createFileRoute("/api/public/hooks/market-context-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = await verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        // Anon-key gate (matches other cron routes).
        const authHeader = request.headers.get("authorization") ?? request.headers.get("apikey");
        if (!authHeader) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const results: unknown[] = [];

        try {
          // 1) Active tickers from odds tape.
          const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
          const { data: tapeRows } = await supabaseAdmin
            .from("btc_odds_tape")
            .select("ticker, strike, spot, seconds_to_close, snapped_at")
            .gte("snapped_at", twoMinAgo)
            .order("snapped_at", { ascending: false })
            .limit(500);

          const perTicker = new Map<
            string,
            { strike: number; spot: number; seconds_to_close: number; snapped_at: string }
          >();
          for (const r of tapeRows ?? []) {
            const t = (r as { ticker: string }).ticker;
            if (!perTicker.has(t)) {
              perTicker.set(t, {
                strike: Number((r as { strike: string | number }).strike),
                spot: Number((r as { spot: string | number }).spot),
                seconds_to_close: Number((r as { seconds_to_close: number }).seconds_to_close),
                snapped_at: (r as { snapped_at: string }).snapped_at,
              });
            }
          }

          for (const [ticker, info] of perTicker) {
            const cp = checkpointForSecondsToClose(info.seconds_to_close);
            if (!cp) continue;
            const closeMs = Date.parse(info.snapped_at) + info.seconds_to_close * 1000;
            const windowEnd = new Date(closeMs);
            const windowStart = new Date(closeMs - 15 * 60 * 1000);
            const r = await writeMarketContext({
              ticker,
              windowStart,
              windowEnd,
              checkpointType: cp,
              strikePrice: info.strike,
            });
            results.push({ ticker, checkpoint: cp, ...r });
          }

          // 2) Fire-time checkpoint: any auto_trade_order created in the last
          //    90s that doesn't yet have a 'fire' row in btc_market_context.
          const ninetySecAgo = new Date(Date.now() - 90_000).toISOString();
          const { data: recentOrders } = await supabaseAdmin
            .from("auto_trade_orders")
            .select("id, ticker, strike, created_at, side, model_prob")
            .gte("created_at", ninetySecAgo)
            .limit(50);

          for (const o of recentOrders ?? []) {
            const row = o as unknown as {
              id: string;
              ticker: string;
              strike: string | number | null;
              created_at: string;
              side: string | null;
              model_prob: number | null;
            };
            if (!row.ticker) continue;
            const createdMs = Date.parse(row.created_at);
            // Estimate window: nearest 15m boundary after created_at.
            const windowEnd = new Date(Math.ceil(createdMs / (15 * 60_000)) * 15 * 60_000);
            const windowStart = new Date(windowEnd.getTime() - 15 * 60_000);
            const r = await writeMarketContext({
              ticker: row.ticker,
              windowStart,
              windowEnd,
              checkpointType: "fire",
              strikePrice: row.strike != null ? Number(row.strike) : null,
              modelProb: row.model_prob,
              modelSide: row.side,
              sideConf: null,
              fired: true,
              orderId: row.id,
            });
            results.push({ orderId: row.id, checkpoint: "fire", ...r });
          }

          return Response.json({ ok: true, processed: results.length, results });
        } catch (e) {
          console.error("[market-context-tick] error", e);
          return new Response(
            JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
