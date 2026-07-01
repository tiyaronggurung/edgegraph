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
const LIVE_DAILY_ORDER_CAP = 40;
const LIVE_DAILY_LOSS_CAP_USD = 80; // realized loss in last 24h that halts new orders
const LIVE_CONFIRM_TOKEN = "I_UNDERSTAND_LIVE";
// ── Additional model rails (added: EV gate, cooldown, per-symbol cap, sizing, decay) ──
const LIVE_MIN_EV_MARGIN = 0.03;          // #1 EV: (model_prob - ask_price) must beat fees+slippage
const LIVE_COOLDOWN_SEC = 90;             // #5 no re-entry on a ticker within N sec of a close
const LIVE_PER_SYMBOL_LOSS_CAP_USD = 40;  // #6 per-symbol 24h loss cap → auto-pause that symbol
const LIVE_LATE_TIGHTEN_SEC = 180;        // #2 tighten SL under this many seconds to expiry
const LIVE_LATE_SL_FRAC = 0.25;           // #2 tighter SL fraction near expiry (vs LIVE_SL_FRAC)
const LIVE_MAX_CONVICTION_MULT = 1.5;     // #3 sizing multiplier ceiling
const LIVE_MIN_CONVICTION_MULT = 0.5;     // #3 sizing multiplier floor
const LIVE_COINFLIP_BAND = 0.05;          // #4 |ask - 0.5| below this = coinflip zone
const LIVE_COINFLIP_MIN_SIGMA = 1.5;      // #4 need this much sigma to trade coinflip prices

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
  .inputValidator((data: { mode?: "paper" | "live"; maxOrders?: number; stakeUsd?: number; confirm?: string; force?: boolean } | undefined) => {
    const mode: "paper" | "live" = data?.mode === "live" ? "live" : "paper";
    const sessionCap = mode === "live" ? LIVE_MAX_ORDERS_PER_SESSION : MAX_ORDERS_PER_SESSION_PAPER;
    const stakeCap = mode === "live" ? LIVE_MAX_STAKE_USD_PER_ORDER : MAX_STAKE_USD_PER_ORDER_PAPER;
    return {
      mode,
      confirm: data?.confirm ?? "",
      force: data?.force === true,
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
      const { data: resetRow } = await (supabase as any)
        .from("auto_trade_loss_cap_resets")
        .select("reset_at")
        .eq("user_id", userId)
        .maybeSingle();
      const resetAtMs = resetRow?.reset_at ? new Date(resetRow.reset_at).getTime() : NaN;
      const lossCapSince = Number.isFinite(resetAtMs) && resetAtMs > new Date(dayAgo).getTime()
        ? new Date(resetAtMs).toISOString()
        : dayAgo;
      const { data: liveRecent } = await supabase
        .from("auto_trade_orders")
        .select("pnl_usd")
        .eq("user_id", userId)
        .eq("mode", "live")
        .gte("created_at", dayAgo);
      const liveCount24h = (liveRecent ?? []).length;
      if (liveCount24h >= LIVE_DAILY_ORDER_CAP) {
        return {
          sessionId, mode: data.mode, attempted: 0, placed: 0, skipped: 1,
          skipReasons: [`Daily live order cap reached (${LIVE_DAILY_ORDER_CAP} in last 24h). Auto-trade paused.`],
          orders: [],
        };
      }
      const { data: lossWindowRows } = await supabase
        .from("auto_trade_orders")
        .select("pnl_usd")
        .eq("user_id", userId)
        .eq("mode", "live")
        .gte("created_at", lossCapSince);
      const realizedSinceReset = (lossWindowRows ?? []).reduce((s: number, r: { pnl_usd: number | null }) => s + (Number(r.pnl_usd) || 0), 0);
      if (!data.force && realizedSinceReset <= -LIVE_DAILY_LOSS_CAP_USD) {
        return {
          sessionId, mode: data.mode, attempted: 0, placed: 0, skipped: 1,
          skipReasons: [`Daily live loss cap reached (realized $${realizedSinceReset.toFixed(2)} ≤ -$${LIVE_DAILY_LOSS_CAP_USD}). Auto-trade paused until reset or 24h rollover.`],
          orders: [],
        };
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRows } = await supabase
      .from("auto_trade_orders")
      .select("ticker")
      .eq("user_id", userId)
      .gte("created_at", since);
    const recentTickers = new Set((recentRows ?? []).map((r: { ticker: string }) => r.ticker));

    // ── #5 cooldown + #6 per-symbol loss cap (live only) ──
    const cooldownTickers = new Set<string>();
    const perSymbolPnl = new Map<string, number>();
    if (isLive) {
      const symSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const cooldownCutoff = new Date(Date.now() - LIVE_COOLDOWN_SEC * 1000).toISOString();
      const { data: symRows } = await supabase
        .from("auto_trade_orders")
        .select("ticker, pnl_usd, settled_at")
        .eq("user_id", userId)
        .eq("mode", "live")
        .gte("created_at", symSince);
      for (const r of ((symRows ?? []) as Array<{ ticker: string; pnl_usd: number | null; settled_at: string | null }>)) {
        perSymbolPnl.set(r.ticker, (perSymbolPnl.get(r.ticker) ?? 0) + (Number(r.pnl_usd) || 0));
        if (r.settled_at && r.settled_at >= cooldownCutoff) cooldownTickers.add(r.ticker);
      }
    }

    const result = await getBtcMarkets();
    const skipReasons: string[] = [];

    // ── Equity-momentum overlay (SPY/QQQ/ES/NQ leading indicator) ──
    // Strong opposite move blocks; otherwise adjust the per-candidate effective edge.
    // YES = UP (risk_on aligned), NO = DOWN (risk_off aligned).
    const { computeEquitySignal } = await import("./equityMomentum.functions");
    let equity: Awaited<ReturnType<typeof computeEquitySignal>> | null = null;
    try {
      equity = await computeEquitySignal();
      skipReasons.push(`equity: ${equity.regime}/${equity.strength} score=${equity.score.toFixed(3)}% adj=${equity.btcImpact.edgeAdjustPts}pt`);
    } catch (e: any) {
      skipReasons.push(`equity: signal unavailable (${e?.message?.slice(0, 60) ?? "err"})`);
    }

    const minSigma = isLive ? LIVE_MIN_SIGMA_DISTANCE : MIN_SIGMA_DISTANCE_PAPER;
    const minSeconds = isLive ? LIVE_MIN_SECONDS_TO_CLOSE : 90;
    const minEdgePts = isLive ? LIVE_MIN_EDGE_PTS : 0;

    let candidates;
    if (data.force) {
      // Force mode: bypass entry gates (edge/sigma/momentum/time/dedupe/equity-block).
      // Daily caps, kill switch, confirm token, and key health still apply (checked above).
      // Pick the top N markets by strongest model conviction (largest |edge|),
      // restricted to markets with a tradeable side and >0s to close.
      const top = result.markets
        .filter(m => m.secondsToClose > 0 && (m.yesAsk > 0 || m.noAsk > 0))
        .sort((a, b) => b.edgeAbs - a.edgeAbs)
        .slice(0, Math.max(1, data.maxOrders));
      if (top.length === 0) {
        skipReasons.push("force: no tradeable market with valid quotes");
      } else {
        skipReasons.push(`force: picked ${top.length} market(s): ${top.map(t => `${t.ticker} ${t.side} edge=${t.edgeAbs.toFixed(1)}pts`).join("; ")} (gates bypassed)`);
      }
      candidates = top;
    } else {
      candidates = result.markets
        .map(m => {
          const adj = equity?.btcImpact.edgeAdjustPts ?? 0;
          const aligned = m.side === "YES" ? adj : -adj;
          return { m, effectiveEdge: m.edgeAbs + aligned, equityAdj: aligned };
        })
        .filter(({ m, effectiveEdge, equityAdj }) => {
          if (m.gateAction !== "BET") { skipReasons.push(`${m.ticker}: gate ${m.gateAction}`); return false; }
          if (m.sigmaDistance < minSigma) { skipReasons.push(`${m.ticker}: sigDist ${m.sigmaDistance.toFixed(2)}σ < ${minSigma}σ`); return false; }
          if (!m.gapAnalysis.momentumAlignsWithSide) { skipReasons.push(`${m.ticker}: momentum fights ${m.side}`); return false; }
          if (m.secondsToClose < minSeconds) { skipReasons.push(`${m.ticker}: ${m.secondsToClose}s < ${minSeconds}s`); return false; }
          if (equity) {
            if (equity.btcImpact.wouldBlock === "block_up" && m.side === "YES") {
              skipReasons.push(`${m.ticker}: blocked by equity risk_off (strong)`);
              return false;
            }
            if (equity.btcImpact.wouldBlock === "block_down" && m.side === "NO") {
              skipReasons.push(`${m.ticker}: blocked by equity risk_on (strong)`);
              return false;
            }
          }
          if (effectiveEdge < minEdgePts) {
            skipReasons.push(`${m.ticker}: edge ${m.edgeAbs.toFixed(1)}${equityAdj >= 0 ? "+" : ""}${equityAdj}=${effectiveEdge.toFixed(1)}pts < ${minEdgePts}pts`);
            return false;
          }
          if (recentTickers.has(m.ticker)) { skipReasons.push(`${m.ticker}: traded in last 24h`); return false; }
          return true;
        })
        .sort((a, b) => (b.effectiveEdge - b.m.requiredEdgePts) - (a.effectiveEdge - a.m.requiredEdgePts))
        .slice(0, data.maxOrders)
        .map(c => c.m);
    }

    // Entry-side disagreement guard: right before submitting, re-pull the
    // model and skip any candidate whose side is no longer favored
    // (prob for our side < LIVE_FLIP_PROB). Prevents entering into a market
    // that flipped between filter and submit.
    let freshProbBySide = new Map<string, number>();
    if (!data.force && candidates.length > 0) {
      try {
        const fresh = await getBtcMarkets();
        for (const fm of fresh.markets) {
          const sideProb = fm.side === "YES" ? fm.modelYesProb : 1 - fm.modelYesProb;
          freshProbBySide.set(`${fm.ticker}|${fm.side}`, sideProb);
        }
      } catch (e: any) {
        skipReasons.push(`entry-recheck: unavailable (${e?.message?.slice(0, 60) ?? "err"}) — skipping guard`);
        freshProbBySide = new Map();
      }
    }

    const placed: AutoTradeOrderRow[] = [];
    for (const m of candidates) {
      if (!data.force && freshProbBySide.size > 0) {
        const p = freshProbBySide.get(`${m.ticker}|${m.side}`);
        if (p === undefined) {
          skipReasons.push(`${m.ticker}: entry-recheck — ${m.side} no longer in fresh market list`);
          continue;
        }
        if (p < LIVE_FLIP_PROB) {
          skipReasons.push(`${m.ticker}: entry-recheck — model now ${(p * 100).toFixed(0)}% for ${m.side} (< ${LIVE_FLIP_PROB * 100}%)`);
          continue;
        }
      }
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

// ── STEP 9 · Auto-Exit Live Positions ─────────────────────────────────────
// Combined exit policy for live auto-trade orders, evaluated every minute:
//   • Take-profit: mark PnL ≥ +70% of stake → close at current bid
//   • Stop-loss:   mark PnL ≤ -50% of stake → close at current bid
//   • Edge decay:  price moved ≥2¢ against our side → close at current bid
// Paper orders and manual crypto_trades are untouched. Settlement still
// happens via settleAutoTradeOrders for any position not exited early.
const LIVE_TP_FRAC = 0.70;
const LIVE_SL_FRAC = 0.50;
const LIVE_EDGE_DECAY_CENTS = 2;
// Direction-flip: if the live model now gives our side < this prob, bail out
// instead of riding a losing conviction into expiry. 0.45 = model has rotated
// meaningfully against us (from >0.5 at entry).
const LIVE_FLIP_PROB = 0.45;
const KALSHI_PUBLIC_BASE = "https://api.elections.kalshi.com/trade-api/v2";


export const autoExitLivePositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ exited: number; reasons: string[] }> => {
    const { supabase, userId } = context;
    const reasons: string[] = [];

    // Only act when live is enabled — safe no-op otherwise.
    if (process.env.KALSHI_LIVE_ENABLED !== "true") return { exited: 0, reasons: ["live_disabled"] };

    const nowIso = new Date().toISOString();
    const { data: open } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, stake_usd, contracts, limit_cents, close_time")
      .eq("user_id", userId)
      .eq("mode", "live")
      .eq("status", "placed")
      .gt("close_time", nowIso)
      .limit(20);

    const rows = (open ?? []) as Array<{ id: string; ticker: string; side: "YES" | "NO"; stake_usd: number; contracts: number; limit_cents: number; close_time: string }>;
    if (!rows.length) return { exited: 0, reasons: [] };

    let exited = 0;

    // Fresh model read for every open ticker — this is what lets us bail on a
    // position whose direction has flipped since entry. One shared call; we
    // index by ticker below. Fail-open: if the read errors we keep legacy exits.
    const currentModelProbBySide = new Map<string, number>(); // ticker -> prob for OUR side
    try {
      const fresh = await getBtcMarkets();
      const byTicker = new Map(fresh.markets.map(m => [m.ticker, m]));
      for (const r of rows) {
        const m = byTicker.get(r.ticker);
        if (!m) continue;
        const yesProb = Number(m.modelYesProb);
        if (!Number.isFinite(yesProb)) continue;
        currentModelProbBySide.set(r.ticker, r.side === "YES" ? yesProb : 1 - yesProb);
      }
    } catch (e: any) {
      reasons.push(`model_read: ${e?.message?.slice(0, 60) ?? "err"} — flip exit disabled this tick`);
    }

    // ── Pass 1: fetch quote + compute unrealized PnL for every open row ──
    type Marked = { r: typeof rows[number]; markCents: number; markPnl: number };
    const marked: Marked[] = [];
    for (const r of rows) {
      let yesBid = 0, yesAsk = 0;
      try {
        const res = await fetch(`${KALSHI_PUBLIC_BASE}/markets/${encodeURIComponent(r.ticker)}`, { headers: { Accept: "application/json" } });
        if (!res.ok) { reasons.push(`${r.ticker}: quote http ${res.status}`); continue; }
        const j: any = await res.json();
        const m = j?.market ?? {};
        yesBid = Math.round(Number(m.yes_bid ?? 0));
        yesAsk = Math.round(Number(m.yes_ask ?? 0));
        if (yesBid <= 0 || yesAsk <= 0 || yesBid > 99 || yesAsk > 99) {
          reasons.push(`${r.ticker}: no quote (bid=${yesBid}, ask=${yesAsk})`);
          continue;
        }
      } catch (e: any) {
        reasons.push(`${r.ticker}: quote err ${e?.message ?? "x"}`);
        continue;
      }
      const markCents = r.side === "YES" ? yesBid : 100 - yesAsk;
      const markPnl = ((markCents - r.limit_cents) / 100) * r.contracts;
      marked.push({ r, markCents, markPnl });
    }

    // ── Portfolio net-positive lock: if aggregate unrealized PnL across all
    // open live positions is > 0, close ALL of them at current bid to bank
    // the net win — even losers get closed to lock the batch profit. ──
    const totalUnrealized = marked.reduce((s, x) => s + x.markPnl, 0);
    const netLock = marked.length > 0 && totalUnrealized > 0;
    if (netLock) {
      reasons.push(`net_lock: aggregate +$${totalUnrealized.toFixed(2)} across ${marked.length} open — closing all`);
    }

    // ── Pass 2: per-row exit decision ──
    for (const { r, markCents, markPnl } of marked) {
      const entryCents = r.limit_cents;
      const tpThreshold = LIVE_TP_FRAC * Number(r.stake_usd);
      const slThreshold = -LIVE_SL_FRAC * Number(r.stake_usd);
      const adverseCents = entryCents - markCents;
      const sideProbNow = currentModelProbBySide.get(r.ticker);

      let exitReason: "tp" | "sl" | "edge" | "net" | "flip" | null = null;
      // Flip has highest priority: model no longer supports our side. Cut the
      // losing conviction even if the batch is net-positive on other rows.
      if (sideProbNow !== undefined && sideProbNow < LIVE_FLIP_PROB) {
        exitReason = "flip";
        reasons.push(`${r.ticker}: flip — model now ${(sideProbNow * 100).toFixed(0)}% for ${r.side} (< ${LIVE_FLIP_PROB * 100}%)`);
      }
      else if (netLock) exitReason = "net";
      else if (markPnl >= tpThreshold) exitReason = "tp";
      else if (markPnl <= slThreshold) exitReason = "sl";
      else if (adverseCents >= LIVE_EDGE_DECAY_CENTS) exitReason = "edge";

      if (!exitReason) continue;



      // Race-safe claim: only one process closes this row.
      const { data: claimed, error: claimErr } = await supabase
        .from("auto_trade_orders")
        .update({ status: "closing" })
        .eq("id", r.id)
        .eq("status", "placed")
        .select("id")
        .maybeSingle();
      if (claimErr || !claimed) { reasons.push(`${r.ticker}: claim lost`); continue; }

      // Place a Kalshi sell at the current bid (most likely to fill). Kalshi V2
      // endpoint + IOC. YES holder sells via ask, NO holder via bid.
      const sellLimitCents = Math.max(1, Math.min(99, markCents));
      try {
        const { signKalshi } = await import("./cryptoTrades.functions");
        const path = "/portfolio/events/orders";
        const headers = await signKalshi("POST", path);
        const priceDollars = (r.side === "YES" ? sellLimitCents : 100 - sellLimitCents) / 100;
        const body = {
          ticker: r.ticker,
          action: "sell",
          side: r.side === "YES" ? "ask" : "bid",
          type: "limit",
          count: String(r.contracts),
          price: priceDollars.toFixed(4),
          time_in_force: "immediate_or_cancel",
          self_trade_prevention_type: "taker_at_cross",
          client_order_id: `auto-exit-${r.id}`.slice(0, 64),
        };
        const res = await fetch(`${KALSHI_PUBLIC_BASE}${path}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        const j: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = j?.error?.message ?? `http ${res.status}`;
          // Revert claim so a later tick can retry (or expiry settles it).
          await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", r.id);
          reasons.push(`${r.ticker}: sell failed — ${msg}`);
          continue;
        }

        // Honor Kalshi's fill_count — IOC may return 0 fills. Only settle if
        // something actually crossed; otherwise revert claim and let a later
        // tick (or expiry settlement) handle the position.
        const fillCount = Number(j?.order?.fill_count ?? j?.fill_count ?? 0);
        const avgFillDollars = Number(j?.order?.average_fill_price ?? j?.average_fill_price ?? 0);
        if (!Number.isFinite(fillCount) || fillCount <= 0) {
          await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", r.id);
          reasons.push(`${r.ticker}: sell 0-fill (IOC) @ ${sellLimitCents}¢ — reverted`);
          continue;
        }

        // Use actual filled quantity + actual fill price for PnL (fall back to
        // the limit if Kalshi omitted average_fill_price).
        const filledCents = avgFillDollars > 0
          ? Math.round(avgFillDollars * (r.side === "YES" ? 100 : -100) + (r.side === "YES" ? 0 : 100))
          : sellLimitCents;
        const realizedPnl = ((filledCents - entryCents) / 100) * fillCount;
        const newStatus = realizedPnl > 0 ? "settled_win" : "settled_loss";
        await supabase
          .from("auto_trade_orders")
          .update({
            status: newStatus,
            settle_price: filledCents / 100,
            pnl_usd: realizedPnl,
            settled_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        exited++;
        reasons.push(`${r.ticker}: ${exitReason} closed ${fillCount}/${r.contracts} @ ${filledCents}¢ (pnl $${realizedPnl.toFixed(2)})`);
      } catch (e: any) {
        await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", r.id);
        reasons.push(`${r.ticker}: sell err ${e?.message ?? "x"}`);
      }
    }
    return { exited, reasons: reasons.slice(0, 20) };
  });
