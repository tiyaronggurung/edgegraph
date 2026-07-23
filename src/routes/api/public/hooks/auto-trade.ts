// Cron-triggered auto-trade hook. Public endpoint; pg_cron calls every minute.
// For each user, places at most 1 paper bet per call ($50 paper stake).
// Primary path uses live markets; if Kalshi rate-limits, fall back to the
// latest stored model prediction so late paper entries still fire.
// up to a lifetime cap of 5 orders, then only settles. No auth header needed
// (this prefix bypasses published-site auth — we still validate apikey).
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { getBtcMarkets } from "@/lib/cryptoBtc.functions";
import { evaluateBtcEntry } from "@/lib/btcEntryGate";
import { getBtcGateConfig } from "@/lib/btcGateConfig.server";
import { logBtcGateDecision } from "@/lib/btcGateLog.server";

const LIFETIME_CAP = 5;
const STAKE_USD = 50;
const MIN_SIGMA = 1.0;
const MIN_SECONDS_TO_CLOSE = 10;
const FALLBACK_MAX_AGE_MS = 5 * 60 * 1000;
const FALLBACK_MIN_EDGE_PTS = 3;

type AutoTradeCandidate = {
  source: "live" | "stored_prediction";
  ticker: string;
  eventTicker: string | null;
  side: "YES" | "NO";
  strike: number;
  spot: number;
  modelYesProb: number;
  yesPrice: number;
  edgePts: number;
  edgeAbs: number;
  sigmaDistance: number;
  gapInSigmas: number;
  secondsToClose: number;
  closeTime: string;
  limitCents: number;
};

function toLimitCents(side: "YES" | "NO", yesPrice: number, yesAsk?: number, noAsk?: number) {
  const price = side === "YES" ? (yesAsk || yesPrice) : (noAsk || (1 - yesPrice));
  return Math.max(1, Math.min(99, Math.round(price * 100)));
}

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

        // 1) Fetch live market snapshot once (shared across users). If Kalshi
        // rate-limits, continue with stored predictions instead of skipping.
        let liveCandidates: AutoTradeCandidate[] = [];
        let marketFetchError: string | undefined;
        try {
          const markets = await getBtcMarkets();
          liveCandidates = markets.markets
            .filter(m =>
              m.gateAction === "BET" &&
              (m.entryGate?.action ?? "PASS") === "BET" &&   // shared universal gate
              m.sigmaDistance >= MIN_SIGMA &&
              m.gapAnalysis.momentumAlignsWithSide &&
              m.secondsToClose >= MIN_SECONDS_TO_CLOSE
            )
            .map(m => ({
              source: "live" as const,
              ticker: m.ticker,
              eventTicker: m.eventTicker,
              side: m.side,
              strike: m.strike,
              spot: m.spot,
              modelYesProb: m.modelYesProb,
              yesPrice: m.yesPrice,
              edgePts: m.edgePts,
              edgeAbs: m.edgeAbs,
              sigmaDistance: m.sigmaDistance,
              gapInSigmas: m.gapAnalysis.gapInSigmas,
              secondsToClose: m.secondsToClose,
              closeTime: m.closeTime ?? new Date(Date.now() + m.secondsToClose * 1000).toISOString(),
              limitCents: toLimitCents(m.side, m.yesPrice, m.yesAsk, m.noAsk),
            }));
        } catch (e) {
          marketFetchError = String(e);
        }

        const nowMs = Date.now();
        const { data: storedRows } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("ticker, event_ticker, strike, side, model_prob, market_yes_price, edge_pts, spot_at_snapshot, close_time, snapshot_seconds_to_close, updated_at")
          .is("outcome", null)
          .gte("close_time", new Date(nowMs + MIN_SECONDS_TO_CLOSE * 1000).toISOString())
          .gte("updated_at", new Date(nowMs - FALLBACK_MAX_AGE_MS).toISOString())
          .order("edge_pts", { ascending: false })
          .limit(20);

        const storedCandidates: AutoTradeCandidate[] = ((storedRows ?? []) as Array<{
          ticker: string;
          event_ticker: string | null;
          strike: number;
          side: "YES" | "NO";
          model_prob: number;
          market_yes_price: number;
          edge_pts: number;
          spot_at_snapshot: number;
          close_time: string;
          snapshot_seconds_to_close: number;
        }>)
          .map(row => {
            const yesPrice = Number(row.market_yes_price);
            const secondsToClose = Math.max(0, Math.ceil((new Date(row.close_time).getTime() - nowMs) / 1000));
            const edgePts = Number(row.edge_pts);
            return {
              source: "stored_prediction" as const,
              ticker: row.ticker,
              eventTicker: row.event_ticker,
              side: row.side,
              strike: Number(row.strike),
              spot: Number(row.spot_at_snapshot),
              modelYesProb: Number(row.model_prob),
              yesPrice,
              edgePts,
              edgeAbs: Math.abs(edgePts),
              sigmaDistance: MIN_SIGMA,
              gapInSigmas: 0,
              secondsToClose,
              closeTime: row.close_time,
              limitCents: toLimitCents(row.side, yesPrice),
            };
          })
          .filter(m => {
            // Baseline sanity filters (unchanged).
            const sideProb = m.side === "YES" ? m.modelYesProb : 1 - m.modelYesProb;
            return (
              m.edgePts >= FALLBACK_MIN_EDGE_PTS &&
              m.secondsToClose >= MIN_SECONDS_TO_CLOSE &&
              Number.isFinite(m.limitCents) &&
              Number.isFinite(m.modelYesProb) &&
              Number.isFinite(m.yesPrice) &&
              sideProb >= 0.25
            );
          });

        // ── Shared central gate for the stored-prediction fallback path ──
        // We have no live order-book here, so yesAsk = market_yes_price
        // (the last known cents value). liveSide is unknown to this path;
        // pass the locked side (no disagreement possible from stored rows).
        const btcGateCfgFallback = await getBtcGateConfig();
        const gatedStoredCandidates: AutoTradeCandidate[] = [];
        for (const c of storedCandidates) {
          const yesAskProb = Number.isFinite(c.yesPrice) && c.yesPrice > 0 && c.yesPrice < 1 ? c.yesPrice : null;
          const noAskProb = yesAskProb !== null ? 1 - yesAskProb : null;
          const decision = evaluateBtcEntry({
            lockedSide: c.side,
            liveSide: c.side,
            modelProb: c.modelYesProb,
            yesAsk: yesAskProb,
            noAsk: noAskProb,
            config: btcGateCfgFallback,
          });
          void logBtcGateDecision({
            decision,
            sourcePath: "stored_prediction_fallback",
            ticker: c.ticker,
            eventId: c.eventTicker ?? null,
            closeTime: c.closeTime,
            secondsToClose: c.secondsToClose,
            modelProb: c.modelYesProb,
            yesAsk: yesAskProb,
            noAsk: noAskProb,
            calibratedEdgeUpstream: c.edgePts / 100,
            config: btcGateCfgFallback,
          });
          if (decision.action === "BET") gatedStoredCandidates.push(c);
        }



        const candidates = [...liveCandidates, ...gatedStoredCandidates]
          .filter((candidate, index, all) => all.findIndex(other => other.ticker === candidate.ticker) === index)
          .sort((a, b) => b.edgeAbs - a.edgeAbs);

        // 2) Iterate every profile and (a) settle (b) place if under cap.
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id");

        let totalPlaced = 0, totalSettled = 0;
        const perUser: Array<{ userId: string; placed: number; settled: number; reason?: string }> = [];

        // Lazy import — server-only exit engine.
        const { autoExitForUser } = await import("@/lib/cryptoAutoTrade.functions");
        let totalExited = 0;
        const perUserExits: Array<{ userId: string; exited: number }> = [];

        for (const p of (profiles ?? []) as Array<{ id: string }>) {
          const userId = p.id;
          let placed = 0, settled = 0, reason: string | undefined;

          // ---- Mid-trade auto-exit sweep (ladder / TP / SL / flip / edge / net-lock) ----
          try {
            const exitRes = await autoExitForUser(supabaseAdmin, userId);
            totalExited += exitRes.exited;
            if (exitRes.exited > 0) perUserExits.push({ userId, exited: exitRes.exited });
          } catch (e) {
            // Never block placement/settlement on exit errors.
            console.error("auto-exit sweep failed", userId, e);
          }


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
            const { fetchKalshiSettlement } = await import("@/lib/kalshiSettle");
            for (const o of pending) {
              // Kalshi is the source of truth. Fall back to internal spot only
              // if Kalshi hasn't finalized yet.
              let won: boolean | null = null;
              let settlePx: number | null = null;
              const k = await fetchKalshiSettlement(o.ticker);
              if (k && k.finalized && k.result) {
                won = o.side === "YES" ? k.result === "yes" : k.result === "no";
                settlePx = k.expirationValue;
              } else {
                const px = priceByTicker.get(o.ticker);
                if (px === undefined) continue;
                won = o.side === "YES" ? px >= Number(o.strike) : px < Number(o.strike);
                settlePx = px;
              }
              const pnl = won
                ? ((100 - o.limit_cents) / 100) * o.contracts
                : -(o.limit_cents / 100) * o.contracts;
              const { error } = await supabaseAdmin
                .from("auto_trade_orders")
                .update({
                  status: won ? "settled_win" : "settled_loss",
                  settle_price: settlePx,
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

          // ---- Pick best eligible market/prediction; allow aggressive paper entries down to T-10s ----
          const candidate = candidates.find(m => !recentTickers.has(m.ticker));

          if (!candidate) {
            reason = marketFetchError
              ? `no eligible market; live fetch failed: ${marketFetchError}`
              : "no eligible market";
            perUser.push({ userId, placed, settled, reason });
            totalSettled += settled;
            continue;
          }

          const m = candidate;
          const limitCents = m.limitCents;
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
              gap_in_sigmas: m.gapInSigmas,
              seconds_to_close: m.secondsToClose,
              close_time: m.closeTime,
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
          totalExited,
          users: perUser.length,
          perUser: perUser.slice(0, 50),
          perUserExits: perUserExits.slice(0, 50),
          ts: new Date().toISOString(),
        });
      },
    },
  },
});
