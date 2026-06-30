// Auto-trade harness: paper mode + LIVE mode with strict guardrails.
// Live mode places real Kalshi RSA-PSS-signed orders. Multiple hard limits
// protect against runaway exposure even if a client bypasses validation:
//   - env KALSHI_LIVE_ENABLED must equal "true" (kill switch, no redeploy)
//   - caller must pass confirm === "I_UNDERSTAND_LIVE"
//   - key health pre-check (RSA-PSS test sign) before any order
//   - stricter signal thresholds than paper (edge, sigma, time-to-close)
//   - per-order stake cap, per-session order cap, 24h order + loss caps
// All identity & writes go through requireSupabaseAuth so RLS scopes rows
// to the calling user.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBtcMarkets } from "./cryptoBtc.functions";

// ── Paper rails (kept for backwards-compat with the existing paper UI) ──
const MAX_ORDERS_PER_SESSION_PAPER = 5;
const MAX_STAKE_USD_PER_ORDER_PAPER = 10;
const MIN_SIGMA_DISTANCE_PAPER = 1.0;

// ── Live rails (stricter — real money) ──
const LIVE_MAX_ORDERS_PER_SESSION = 3;
const LIVE_MAX_STAKE_USD_PER_ORDER = 20;
const LIVE_MIN_SIGMA_DISTANCE = 1.25;
const LIVE_MIN_EDGE_PTS = 5;
const LIVE_MIN_SECONDS_TO_CLOSE = 120;
const LIVE_DAILY_ORDER_CAP = 10;
const LIVE_DAILY_LOSS_CAP_USD = 60; // realized loss in last 24h that halts new orders
const LIVE_CONFIRM_TOKEN = "I_UNDERSTAND_LIVE";

export interface AutoTradeOrderRow {
  id: string;
  ticker: string;
  side: "YES" | "NO";
  stake_usd: number;
  contracts: number;
  limit_cents: number;
  status: string;
  mode: "paper" | "live";
  model_prob: number;
  edge_pts: number;
  sigma_distance: number;
  close_time: string;
  pnl_usd: number | null;
  settle_price: number | null;
  created_at: string;
}

export interface AutoTradeRunResult {
  sessionId: string;
  mode: "paper" | "live";
  attempted: number;
  placed: number;
  skipped: number;
  skipReasons: string[];
  orders: AutoTradeOrderRow[];
}

export const runAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { mode?: "paper" | "live"; maxOrders?: number; stakeUsd?: number; confirm?: string } | undefined) => {
    const mode = data?.mode === "live" ? "live" : "paper";
    const sessionCap = mode === "live" ? LIVE_MAX_ORDERS_PER_SESSION : MAX_ORDERS_PER_SESSION_PAPER;
    const stakeCap = mode === "live" ? LIVE_MAX_STAKE_USD_PER_ORDER : MAX_STAKE_USD_PER_ORDER_PAPER;
    return {
      mode,
      confirm: data?.confirm ?? "",
      maxOrders: Math.min(sessionCap, Math.max(1, data?.maxOrders ?? sessionCap)),
      stakeUsd: Math.min(stakeCap, Math.max(1, data?.stakeUsd ?? stakeCap)),
    };
  })
  .handler(async ({ data, context }): Promise<AutoTradeRunResult> => {
    const { supabase, userId } = context;
    const sessionId = crypto.randomUUID();
    const isLive = data.mode === "live";

    // ── Live-mode preflight: kill switch + explicit confirm + key health ──
    if (isLive) {
      if (process.env.KALSHI_LIVE_ENABLED !== "true") {
        throw new Error("Live trading is disabled. Set KALSHI_LIVE_ENABLED=true to enable.");
      }
      if (data.confirm !== LIVE_CONFIRM_TOKEN) {
        throw new Error(`Live trading requires confirm="${LIVE_CONFIRM_TOKEN}".`);
      }
      const { getValidatedKalshiKey } = await import("./cryptoTrades.functions");
      try {
        await getValidatedKalshiKey();
      } catch (e: any) {
        throw new Error(`Kalshi key precheck failed: ${e?.message ?? String(e)}`);
      }

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: liveRecent } = await supabase
        .from("auto_trade_orders")
        .select("pnl_usd")
        .eq("user_id", userId)
        .eq("mode", "live")
        .gte("created_at", dayAgo);
      const liveCount24h = (liveRecent ?? []).length;
      if (liveCount24h >= LIVE_DAILY_ORDER_CAP) {
        throw new Error(`Daily live order cap reached (${LIVE_DAILY_ORDER_CAP} in last 24h).`);
      }
      const realized24h = (liveRecent ?? []).reduce((s: number, r: { pnl_usd: number | null }) => s + (Number(r.pnl_usd) || 0), 0);
      if (realized24h <= -LIVE_DAILY_LOSS_CAP_USD) {
        throw new Error(`Daily live loss cap reached (realized $${realized24h.toFixed(2)} ≤ -$${LIVE_DAILY_LOSS_CAP_USD}).`);
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRows } = await supabase
      .from("auto_trade_orders")
      .select("ticker")
      .eq("user_id", userId)
      .gte("created_at", since);
    const recentTickers = new Set((recentRows ?? []).map((r: { ticker: string }) => r.ticker));

    const result = await getBtcMarkets();
    const skipReasons: string[] = [];

    const minSigma = isLive ? LIVE_MIN_SIGMA_DISTANCE : MIN_SIGMA_DISTANCE_PAPER;
    const minSeconds = isLive ? LIVE_MIN_SECONDS_TO_CLOSE : 90;
    const minEdgePts = isLive ? LIVE_MIN_EDGE_PTS : 0;

    const candidates = result.markets
      .filter(m => {
        if (m.gateAction !== "BET") { skipReasons.push(`${m.ticker}: gate ${m.gateAction}`); return false; }
        if (m.sigmaDistance < minSigma) { skipReasons.push(`${m.ticker}: sigDist ${m.sigmaDistance.toFixed(2)}σ < ${minSigma}σ`); return false; }
        if (!m.gapAnalysis.momentumAlignsWithSide) { skipReasons.push(`${m.ticker}: momentum fights ${m.side}`); return false; }
        if (m.secondsToClose < minSeconds) { skipReasons.push(`${m.ticker}: ${m.secondsToClose}s < ${minSeconds}s`); return false; }
        if (m.edgeAbs < minEdgePts) { skipReasons.push(`${m.ticker}: edge ${m.edgeAbs.toFixed(1)}pts < ${minEdgePts}pts`); return false; }
        if (recentTickers.has(m.ticker)) { skipReasons.push(`${m.ticker}: traded in last 24h`); return false; }
        return true;
      })
      .sort((a, b) => (b.edgeAbs - b.requiredEdgePts) - (a.edgeAbs - a.requiredEdgePts))
      .slice(0, data.maxOrders);

    const placed: AutoTradeOrderRow[] = [];
    for (const m of candidates) {
      const limitCents = Math.max(1, Math.min(99, Math.round(
        (m.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice))) * 100,
      )));
      const contracts = Math.max(1, Math.floor((data.stakeUsd * 100) / limitCents));
      const stakeActual = (contracts * limitCents) / 100;

      let kalshiOrderId: string | null = null;
      if (isLive) {
        try {
          const { submitKalshiBuy } = await import("./cryptoTrades.functions");
          const out = await submitKalshiBuy(supabase, userId, {
            ticker: m.ticker,
            eventTicker: m.eventTicker ?? undefined,
            side: m.side,
            contracts,
            limitPriceCents: limitCents,
            strike: m.strike,
            spot: m.spot,
            modelProb: m.modelYesProb,
            marketYesPrice: m.yesPrice,
            edgePts: m.edgePts,
            stakeUsd: stakeActual,
            closeTime: m.closeTime ?? undefined,
          });
          kalshiOrderId = out.orderId;
        } catch (e: any) {
          skipReasons.push(`${m.ticker}: kalshi order failed — ${e?.message ?? String(e)}`);
          continue;
        }
      }

      const { data: row, error } = await supabase
        .from("auto_trade_orders")
        .insert({
          user_id: userId,
          session_id: sessionId,
          mode: isLive ? "live" : "paper",
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
          kalshi_order_id: kalshiOrderId,
        })
        .select("id, ticker, side, stake_usd, contracts, limit_cents, status, mode, model_prob, edge_pts, sigma_distance, close_time, pnl_usd, settle_price, created_at")
        .single();

      if (error) { skipReasons.push(`${m.ticker}: insert error ${error.message}`); continue; }
      if (row) placed.push(row as AutoTradeOrderRow);
    }

    return {
      sessionId, mode: data.mode,
      attempted: candidates.length,
      placed: placed.length,
      skipped: skipReasons.length,
      skipReasons: skipReasons.slice(0, 20),
      orders: placed,
    };
  });

export const listAutoTradeOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders: AutoTradeOrderRow[]; totals: { placed: number; wins: number; losses: number; pnlUsd: number } }> => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, stake_usd, contracts, limit_cents, status, mode, model_prob, edge_pts, sigma_distance, close_time, pnl_usd, settle_price, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    const orders = (rows ?? []) as AutoTradeOrderRow[];
    const wins = orders.filter(o => o.status === "settled_win").length;
    const losses = orders.filter(o => o.status === "settled_loss").length;
    const pnlUsd = orders.reduce((s, o) => s + (Number(o.pnl_usd) || 0), 0);
    return { orders, totals: { placed: orders.length, wins, losses, pnlUsd } };
  });

// Settle paper orders whose close_time has passed by looking up the actual
// BTC close price stored in prediction_closes (populated by the existing
// settle path). YES wins iff settle_price >= strike; NO wins iff < strike.
// PnL: win = (1 - limit_cents/100) * contracts; loss = -limit_cents/100 * contracts.
export const settleAutoTradeOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ settled: number }> => {
    const { supabase, userId } = context;
    const { data: due } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, strike, contracts, limit_cents, close_time")
      .eq("user_id", userId)
      .eq("status", "placed")
      .lt("close_time", new Date().toISOString())
      .limit(50);
    const pending = (due ?? []) as Array<{ id: string; ticker: string; side: "YES" | "NO"; strike: number; contracts: number; limit_cents: number; close_time: string }>;
    if (!pending.length) return { settled: 0 };

    // Pull settle prices from btc_model_predictions (already populated by the
    // existing settle path for the same 15m windows). Skip orders whose
    // window hasn't been settled yet — try again next call.
    const tickers = [...new Set(pending.map(o => o.ticker))];
    const { data: closes } = await supabase
      .from("btc_model_predictions")
      .select("ticker, settle_price")
      .in("ticker", tickers)
      .not("settle_price", "is", null);
    const priceByTicker = new Map<string, number>(
      ((closes ?? []) as Array<{ ticker: string; settle_price: number | null }>)
        .filter(c => c.settle_price !== null)
        .map(c => [c.ticker, Number(c.settle_price)]),
    );

    let settled = 0;
    for (const o of pending) {
      const px = priceByTicker.get(o.ticker);
      if (px === undefined) continue;
      const won = o.side === "YES" ? px >= Number(o.strike) : px < Number(o.strike);
      const pnl = won
        ? ((100 - o.limit_cents) / 100) * o.contracts
        : -(o.limit_cents / 100) * o.contracts;
      const { error } = await supabase
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
    return { settled };
  });
