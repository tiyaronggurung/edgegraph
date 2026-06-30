// Auto-trade harness: paper mode by default.
// Picks up to N model picks (gateAction === "BET") per session, with stricter
// safety than the regular gate (sigDist ≥ 1σ AND momentumAlignsWithSide=true),
// and logs them to auto_trade_orders. Live mode (real Kalshi orders) is gated
// behind explicit mode='live' input — the default is always paper.
//
// All identity & writes go through requireSupabaseAuth so RLS scopes rows to
// the calling user. Hard-coded session caps prevent runaway exposure even if
// upstream validation is bypassed.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBtcMarkets } from "./cryptoBtc.functions";

const MAX_ORDERS_PER_SESSION = 5;
const MAX_STAKE_USD_PER_ORDER = 10;
const MIN_SIGMA_DISTANCE_AUTOTRADE = 1.0; // stricter than the manual gate's pin-risk floor

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
  .inputValidator((data: { mode?: "paper" | "live"; maxOrders?: number; stakeUsd?: number } | undefined) => ({
    mode: data?.mode === "live" ? "live" : "paper",
    maxOrders: Math.min(MAX_ORDERS_PER_SESSION, Math.max(1, data?.maxOrders ?? 5)),
    stakeUsd: Math.min(MAX_STAKE_USD_PER_ORDER, Math.max(1, data?.stakeUsd ?? 10)),
  }))
  .handler(async ({ data, context }): Promise<AutoTradeRunResult> => {
    const { supabase, userId } = context;
    const sessionId = crypto.randomUUID();

    // Live mode: hard-block in this version. We ship paper-only first; once
    // 5 paper cycles settle clean, flip this branch to call placeKalshiOrder.
    if (data.mode === "live") {
      throw new Error("Live mode disabled — paper-trade only until first 5 paper orders settle cleanly.");
    }

    // De-dupe: never reissue orders for tickers we've already auto-traded
    // in the last 24h, regardless of session.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRows } = await supabase
      .from("auto_trade_orders")
      .select("ticker")
      .eq("user_id", userId)
      .gte("created_at", since);
    const recentTickers = new Set((recentRows ?? []).map((r: { ticker: string }) => r.ticker));

    const result = await getBtcMarkets();
    const skipReasons: string[] = [];

    // Stricter eligibility than the manual BET gate:
    //  - gateAction === "BET" (passes pin-risk + traversal + edge)
    //  - sigma distance ≥ 1.0σ (extra safety for autopilot)
    //  - gap momentum aligned with the picked side
    //  - secondsToClose ≥ 90 (room to fill)
    //  - not already traded in last 24h
    const candidates = result.markets
      .filter(m => {
        if (m.gateAction !== "BET") { skipReasons.push(`${m.ticker}: gate ${m.gateAction}`); return false; }
        if (m.sigmaDistance < MIN_SIGMA_DISTANCE_AUTOTRADE) { skipReasons.push(`${m.ticker}: sigDist ${m.sigmaDistance.toFixed(2)}σ < 1.0σ`); return false; }
        if (!m.gapAnalysis.momentumAlignsWithSide) { skipReasons.push(`${m.ticker}: momentum fights ${m.side}`); return false; }
        if (m.secondsToClose < 90) { skipReasons.push(`${m.ticker}: ${m.secondsToClose}s too tight`); return false; }
        if (recentTickers.has(m.ticker)) { skipReasons.push(`${m.ticker}: traded in last 24h`); return false; }
        return true;
      })
      .sort((a, b) => (b.edgeAbs - b.requiredEdgePts) - (a.edgeAbs - a.requiredEdgePts))
      .slice(0, data.maxOrders);

    const placed: AutoTradeOrderRow[] = [];
    for (const m of candidates) {
      // Limit price: cross spread to fill (BET-side ask). Cap at 99¢.
      const limitCents = Math.max(1, Math.min(99, Math.round(
        (m.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice))) * 100,
      )));
      const contracts = Math.max(1, Math.floor((data.stakeUsd * 100) / limitCents));
      const stakeActual = (contracts * limitCents) / 100;

      const { data: row, error } = await supabase
        .from("auto_trade_orders")
        .insert({
          user_id: userId,
          session_id: sessionId,
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
          close_time: m.closeTime,
          status: "placed",
        })
        .select("id, ticker, side, stake_usd, contracts, limit_cents, status, mode, model_prob, edge_pts, sigma_distance, close_time, pnl_usd, settle_price, created_at")
        .single();

      if (error) { skipReasons.push(`${m.ticker}: insert error ${error.message}`); continue; }
      if (row) placed.push(row as AutoTradeOrderRow);
    }

    return {
      sessionId, mode: "paper",
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

    // Pull close prices from prediction_closes if the model already settled
    // the corresponding minute window; fall back to skipping for next cycle.
    const closeTimes = [...new Set(pending.map(o => o.close_time))];
    const { data: closes } = await supabase
      .from("prediction_closes")
      .select("close_time, settle_price")
      .in("close_time", closeTimes);
    const priceByTime = new Map<string, number>(
      ((closes ?? []) as Array<{ close_time: string; settle_price: number | null }>)
        .filter(c => c.settle_price !== null)
        .map(c => [new Date(c.close_time).toISOString(), Number(c.settle_price)]),
    );

    let settled = 0;
    for (const o of pending) {
      const px = priceByTime.get(new Date(o.close_time).toISOString());
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
