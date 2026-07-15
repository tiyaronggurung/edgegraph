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
import { getBtcMarkets, computeBtcMarkets } from "./cryptoBtc.functions";
import type { SupabaseClient } from "@supabase/supabase-js";


// ── Paper rails (kept for backwards-compat with the existing paper UI) ──
const MAX_ORDERS_PER_SESSION_PAPER = 5;
const MAX_STAKE_USD_PER_ORDER_PAPER = 10;
const MIN_SIGMA_DISTANCE_PAPER = 1.0;

// ── Live rails (stricter — real money) ──
const LIVE_MAX_ORDERS_PER_SESSION = 3;
const LIVE_MAX_STAKE_USD_PER_ORDER = 150; // matches DEFAULT_LADDER_CONFIG.maxStake
const LIVE_MIN_SIGMA_DISTANCE = 1.25;
const LIVE_MIN_EDGE_PTS = 5;
const LIVE_MIN_SECONDS_TO_CLOSE = 120;
const LIVE_DAILY_ORDER_CAP = 40;
const LIVE_DAILY_LOSS_CAP_USD = 250; // realized loss in last 24h that halts new orders (50% of $500 bankroll)
const LIVE_CONFIRM_TOKEN = "I_UNDERSTAND_LIVE";
// ── Additional model rails (added: EV gate, cooldown, per-symbol cap, sizing, decay) ──
const LIVE_MIN_EV_MARGIN = 0.03;          // #1 EV: (model_prob - ask_price) must beat fees+slippage
const LIVE_COOLDOWN_SEC = 90;             // #5 no re-entry on a ticker within N sec of a close
const LIVE_PER_SYMBOL_LOSS_CAP_USD = 40;  // #6 per-symbol 24h loss cap → auto-pause that symbol
const LIVE_LATE_TIGHTEN_SEC = 180;        // #2 tighten SL under this many seconds to expiry
const LIVE_LATE_SL_FRAC = 0.25;           // #2 tighter SL fraction near expiry (vs LIVE_SL_FRAC)
const LIVE_COINFLIP_BAND = 0.05;          // #4 |ask - 0.5| below this = coinflip zone
const LIVE_COINFLIP_MIN_SIGMA = 1.5;      // #4 need this much sigma to trade coinflip prices

// ── Kalshi-leaned primary + model-side disagreement probe ──
// Primary bet follows the leg Kalshi prices as favorite (yesPrice ≥ threshold
// → YES, ≤ 1-threshold → NO). Model gates still evaluate on the model-picked
// side (m.side) upstream; we just flip the side we actually submit for the
// primary. If the model disagrees with Kalshi's lean, we also fire a small
// probe on the model side ($10, or $20 when model edge is strong).
const KALSHI_LEAN_THRESHOLD = 0.55;       // yesPrice ≥ 0.55 → Kalshi leans YES; ≤ 0.45 → NO
const MODEL_PROBE_STAKE_LOW = 10;
const MODEL_PROBE_STAKE_HIGH = 20;
const MODEL_PROBE_STRONG_EDGE_PTS = 6;    // model edge ≥ this → probe with HIGH stake

// ── Odds-ladder exit tiers (price deltas in Kalshi ¢) ──
// Each order snapshots this at entry so changing defaults never affects live positions.
// Priority order: stop-loss first (safety), then most-aggressive TP, then partial.
export type ExitLadderTier = {
  kind: "tp" | "sl";
  priceDeltaCents: number;   // signed: +N = mark improved N¢, -N = mark dropped N¢
  exitFraction: number;      // 0 < f ≤ 1, fraction of REMAINING contracts to close
  label: string;
};
export const DEFAULT_EXIT_LADDER: ExitLadderTier[] = [
  // Bold/strict exit: SL tightened -15¢ → -8¢ so we bail on the first real
  // adverse move instead of riding a full crash to zero. TP unchanged.
  { kind: "sl", priceDeltaCents: -8,  exitFraction: 1.0, label: "SL -8¢" },
  { kind: "tp", priceDeltaCents: +12, exitFraction: 1.0, label: "TP +12¢" },
  { kind: "tp", priceDeltaCents: +6,  exitFraction: 0.5, label: "Partial TP +6¢" },
];

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
  entry_price_cents: number | null;
  contracts_remaining: number | null;
  partial_pnl_usd: number | null;
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

export type RunAutoTradeInput = {
  mode: "paper" | "live";
  confirm: string;
  force: boolean;
  isMartingale: boolean;
  maxOrders: number;
  stakeUsd: number;
  forceTicker: string | undefined;
  forceSide: "YES" | "NO" | undefined;
  maxEntryCents?: number | undefined;
  skipLadder?: boolean;
};

export const runAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { mode?: "paper" | "live"; maxOrders?: number; stakeUsd?: number; confirm?: string; force?: boolean; isMartingale?: boolean; forceTicker?: string; forceSide?: "YES" | "NO"; maxEntryCents?: number; skipLadder?: boolean } | undefined) => {
    const mode: "paper" | "live" = data?.mode === "live" ? "live" : "paper";
    const sessionCap = mode === "live" ? LIVE_MAX_ORDERS_PER_SESSION : MAX_ORDERS_PER_SESSION_PAPER;
    const stakeCap = mode === "live" ? LIVE_MAX_STAKE_USD_PER_ORDER : MAX_STAKE_USD_PER_ORDER_PAPER;
    const rawMax = Number(data?.maxEntryCents);
    return {
      mode,
      confirm: data?.confirm ?? "",
      force: data?.force === true,
      isMartingale: data?.isMartingale === true,
      maxOrders: Math.min(sessionCap, Math.max(1, data?.maxOrders ?? sessionCap)),
      stakeUsd: Math.min(stakeCap, Math.max(1, data?.stakeUsd ?? stakeCap)),
      forceTicker: typeof data?.forceTicker === "string" && data.forceTicker.length > 0 ? data.forceTicker : undefined,
      forceSide: data?.forceSide === "YES" || data?.forceSide === "NO" ? data.forceSide : undefined,
      maxEntryCents: Number.isFinite(rawMax) && rawMax >= 1 && rawMax <= 95 ? rawMax : undefined,
      skipLadder: data?.skipLadder === true,
    } satisfies RunAutoTradeInput;
  })

  .handler(async ({ data, context }): Promise<AutoTradeRunResult> =>
    runAutoTradeCore(context.supabase as SupabaseClient, context.userId, data),
  );

export async function runAutoTradeCore(
  supabase: SupabaseClient,
  userId: string,
  data: RunAutoTradeInput,
): Promise<AutoTradeRunResult> {

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

      // ── Profit-Bank Ladder stake (live only) ──
      // Single source of truth: same replayLadder state machine the
      // NextStakeBanner reads via getOddsShadowReport. Banner-displayed
      // "Next stake" == the amount we fire here.
      // Skip when caller opts out (Model Bet uses flat $10, not the ladder).
      if (!data.skipLadder) try {
        const { loadLadderConfig } = await import("./stakingConfig.server");
        const { replayLadder } = await import("./profitBankLadder");
        const LIVE_BANK_SEED_USD = 71;
        const LIVE_BANK_CUTOFF_ISO = "2026-07-08T04:47:00Z";
        const cfg = await loadLadderConfig(supabase, userId);
        const { data: settled } = await supabase
          .from("auto_trade_orders")
          .select("pnl_usd, status, settled_at")
          .eq("user_id", userId)
          .eq("mode", "live")
          .in("status", ["settled_win", "settled_loss"])
          .gte("settled_at", LIVE_BANK_CUTOFF_ISO)
          .order("settled_at", { ascending: true })
          .limit(2000);
        const orders = ((settled ?? []) as Array<{ status: string; pnl_usd: number | string }>).map(r => ({
          won: r.status === "settled_win",
          pnl_usd: Number(r.pnl_usd) || 0,
        }));
        const ladder = replayLadder(orders, cfg, LIVE_BANK_SEED_USD);
        (data as { stakeUsd: number }).stakeUsd = ladder.nextStake;
      } catch (e: any) {
        // If the ladder read fails, fall through to whatever the caller passed
        // (already clamped by the input validator's stakeCap = $100 live).
        // Do NOT block the trade — the outer LIVE_MAX_STAKE_USD_PER_ORDER
        // cap still applies.
        // eslint-disable-next-line no-console
        console.warn("[live-stake] ladder read failed:", e?.message ?? e);
      }

      // ── Balance-aware stake sizing (live only) ──
      // If Kalshi cash balance < requested stake, shrink stake to whole
      // remaining balance (rounded down to $1). Skip if balance < $1.
      try {
        const { signKalshi: _sign } = await import("./cryptoTrades.functions");
        const path = "/portfolio/balance";
        const headers = await _sign("GET", path, userId);
        const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2${path}`, { method: "GET", headers });
        if (res.ok) {
          const j: any = await res.json().catch(() => null);
          const balCents = typeof j?.balance === "number" ? j.balance : null;
          if (balCents !== null) {
            const balUsd = balCents / 100;
            if (balUsd < 1) {
              return {
                sessionId, mode: data.mode, attempted: 0, placed: 0, skipped: 1,
                skipReasons: [`Kalshi balance $${balUsd.toFixed(2)} < $1 — no stake available.`],
                orders: [],
              };
            }
            if (balUsd < data.stakeUsd) {
              const shrunk = Math.max(1, Math.floor(balUsd));
              (data as { stakeUsd: number }).stakeUsd = shrunk;
            }
          }
        }
      } catch {
        // Balance probe is best-effort; fall through to normal stake if it fails.
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
      if (!data.force && liveCount24h >= LIVE_DAILY_ORDER_CAP) {
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

    const result = await computeBtcMarkets();
    const skipReasons: string[] = [];

    // "NO-side only" filter — when ON, auto-trade skips any candidate whose
    // value-pick side is YES. Backtest on 903 settled BTC predictions showed
    // VP=NO subset delivers +3.8% ROI vs +1.8% blind. Default OFF.
    let vpNoOnly = false;
    try {
      const { data: vpRow } = await (supabase as any)
        .from("auto_odds_settings")
        .select("vp_no_only")
        .eq("user_id", userId)
        .maybeSingle();
      vpNoOnly = Boolean((vpRow as { vp_no_only?: boolean } | null)?.vp_no_only);
    } catch { /* default false */ }

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

    // ── Model Bet quality gates (isotonic + confidence/edge + streak + regime) ──
    // Additive skip-only filter, applied ONLY on live model_bet path and only
    // when force is off. Never sizes, never buys. Result is a per-ticker+side
    // map consulted inside the existing filter chain below.
    const modelGateResults = new Map<string, { allow: boolean; skipReason?: string; note: string }>();
    let modelGateActive = false;
    if (isLive && !data.force) {
      try {
        const { data: btRow } = await (supabase as any)
          .from("auto_odds_settings")
          .select("auto_button_type")
          .eq("user_id", userId)
          .maybeSingle();
        if ((btRow as { auto_button_type?: string } | null)?.auto_button_type === "model_bet") {
          modelGateActive = true;
          const { runModelGates } = await import("./modelGates.server");
          await Promise.all(
            result.markets.map(async mm => {
              try {
                const g = await runModelGates(supabase, userId, {
                  ticker: mm.ticker, side: mm.side, modelYesProb: mm.modelYesProb,
                  yesAsk: mm.yesAsk, noAsk: mm.noAsk, yesPrice: mm.yesPrice,
                  strike: mm.strike, spot: mm.spot,
                  secondsToClose: mm.secondsToClose, sigmaDistance: mm.sigmaDistance,
                });
                modelGateResults.set(`${mm.ticker}|${mm.side}`, {
                  allow: g.allow, skipReason: g.skipReason, note: g.note,
                });
              } catch (e: any) {
                // Fail-open: gate error must not block trading; existing gates still run.
                modelGateResults.set(`${mm.ticker}|${mm.side}`, {
                  allow: true, note: `gate-err: ${e?.message?.slice(0, 40) ?? "err"}`,
                });
              }
            }),
          );
        }
      } catch { /* no settings row → gate off, existing behavior */ }
    }

    let candidates;
    if (data.force) {
      // Force mode: bypass entry gates (edge/sigma/momentum/time/dedupe/equity-block).
      // Daily caps, kill switch, confirm token, and key health still apply (checked above).
      let top: typeof result.markets;
      if (data.forceTicker && data.forceSide) {
        // Odds-driven bet: caller specifies exact ticker + side; ignore model pick.
        const found = result.markets.find(mm => mm.ticker === data.forceTicker && mm.secondsToClose > 0);
        if (!found) {
          top = [];
          skipReasons.push(`force: ticker ${data.forceTicker} not found or expired`);
        } else {
          // Override side so downstream uses caller's chosen leg (YES/NO ask, insert).
          top = [{ ...found, side: data.forceSide }];
          skipReasons.push(`odds-bet: ${data.forceTicker} ${data.forceSide} (kalshi odds pick)`);
        }
      } else {
        // Pick the top N markets by strongest model conviction (largest |edge|),
        // restricted to markets with a tradeable side and >0s to close.
        top = result.markets
          .filter(m => m.secondsToClose > 0 && (m.yesAsk > 0 || m.noAsk > 0))
          .sort((a, b) => b.edgeAbs - a.edgeAbs)
          .slice(0, Math.max(1, data.maxOrders));
        if (top.length === 0) {
          skipReasons.push("force: no tradeable market with valid quotes");
        } else {
          skipReasons.push(`force: picked ${top.length} market(s): ${top.map(t => `${t.ticker} ${t.side} edge=${t.edgeAbs.toFixed(1)}pts`).join("; ")} (gates bypassed)`);
        }
      }
      candidates = top;
    } else {
      // #7 counterfactual log: collect skipped candidates for post-hoc analysis
      type SkipRow = {
        user_id: string; ticker: string; side: "YES" | "NO"; skip_reason: string;
        model_prob: number | null; ask_price: number | null; ev_edge: number | null;
        sigma_distance: number | null; seconds_to_close: number | null;
        strike: number | null; spot_at_skip: number | null; close_time: string | null;
      };
      const skipLog: SkipRow[] = [];
      const logSkip = (m: typeof result.markets[number], reason: string) => {
        const ask = m.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice));
        const prob = m.side === "YES" ? m.modelYesProb : 1 - m.modelYesProb;
        skipLog.push({
          user_id: userId, ticker: m.ticker, side: m.side, skip_reason: reason,
          model_prob: prob, ask_price: ask, ev_edge: prob - ask,
          sigma_distance: m.sigmaDistance, seconds_to_close: m.secondsToClose,
          strike: m.strike, spot_at_skip: m.spot,
          close_time: m.closeTime ?? new Date(Date.now() + m.secondsToClose * 1000).toISOString(),
        });
      };

      candidates = result.markets
        .map(m => {
          const adj = equity?.btcImpact.edgeAdjustPts ?? 0;
          const aligned = m.side === "YES" ? adj : -adj;
          return { m, effectiveEdge: m.edgeAbs + aligned, equityAdj: aligned };
        })
        .filter(({ m, effectiveEdge, equityAdj }) => {
          if (modelGateActive) {
            const g = modelGateResults.get(`${m.ticker}|${m.side}`);
            if (g && !g.allow) {
              const r = g.skipReason ?? "model-gate skip";
              skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
            }
          }
          if (vpNoOnly && m.side === "YES") {
            const r = "vp_no_only: value-pick YES filtered (NO-only toggle ON)";
            skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
          }
          if (m.gateAction !== "BET") { const r = `gate ${m.gateAction}`; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false; }
          if (m.sigmaDistance < minSigma) { const r = `sigDist ${m.sigmaDistance.toFixed(2)}σ < ${minSigma}σ`; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false; }
          if (!m.gapAnalysis.momentumAlignsWithSide) { const r = `momentum fights ${m.side}`; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false; }
          if (m.secondsToClose < minSeconds) { const r = `${m.secondsToClose}s < ${minSeconds}s`; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false; }
          if (equity) {
            if (equity.btcImpact.wouldBlock === "block_up" && m.side === "YES") {
              const r = "blocked by equity risk_off (strong)"; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
            }
            if (equity.btcImpact.wouldBlock === "block_down" && m.side === "NO") {
              const r = "blocked by equity risk_on (strong)"; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
            }
          }
          if (effectiveEdge < minEdgePts) {
            const r = `edge ${m.edgeAbs.toFixed(1)}${equityAdj >= 0 ? "+" : ""}${equityAdj}=${effectiveEdge.toFixed(1)}pts < ${minEdgePts}pts`;
            skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
          }
          if (recentTickers.has(m.ticker)) { const r = "traded in last 24h"; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false; }
          if (isLive && cooldownTickers.has(m.ticker)) {
            const r = `cooldown (closed < ${LIVE_COOLDOWN_SEC}s ago)`; skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
          }
          if (isLive) {
            const symPnl = perSymbolPnl.get(m.ticker) ?? 0;
            if (symPnl <= -LIVE_PER_SYMBOL_LOSS_CAP_USD) {
              const r = `symbol loss cap ($${symPnl.toFixed(2)} ≤ -$${LIVE_PER_SYMBOL_LOSS_CAP_USD})`;
              skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
            }
          }
          const askDollarsFilter = m.side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice));
          const ourProbFilter = m.side === "YES" ? m.modelYesProb : 1 - m.modelYesProb;
          const evEdgeFilter = ourProbFilter - askDollarsFilter;
          if (evEdgeFilter < LIVE_MIN_EV_MARGIN) {
            const r = `EV ${(evEdgeFilter * 100).toFixed(1)}¢ < ${LIVE_MIN_EV_MARGIN * 100}¢ (prob ${(ourProbFilter * 100).toFixed(0)}% vs ask ${(askDollarsFilter * 100).toFixed(0)}¢)`;
            skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
          }
          if (Math.abs(askDollarsFilter - 0.5) < LIVE_COINFLIP_BAND && m.sigmaDistance < LIVE_COINFLIP_MIN_SIGMA) {
            const r = `coinflip price ${(askDollarsFilter * 100).toFixed(0)}¢ needs ≥${LIVE_COINFLIP_MIN_SIGMA}σ (have ${m.sigmaDistance.toFixed(2)}σ)`;
            skipReasons.push(`${m.ticker}: ${r}`); logSkip(m, r); return false;
          }
          return true;
        })
        .sort((a, b) => (b.effectiveEdge - b.m.requiredEdgePts) - (a.effectiveEdge - a.m.requiredEdgePts))
        .slice(0, data.maxOrders)
        .map(c => c.m);

      // Fire-and-forget insert; failure of the log must not block trading.
      if (skipLog.length > 0) {
        (async () => {
          try { await (supabase as any).from("auto_trade_skip_log").insert(skipLog); } catch { /* noop */ }
        })();
      }
    }

    // Entry-side disagreement guard: right before submitting, re-pull the
    // model and skip any candidate whose side is no longer favored
    // (prob for our side < LIVE_FLIP_PROB). Prevents entering into a market
    // that flipped between filter and submit.
    let freshProbBySide = new Map<string, number>();
    if (!data.force && candidates.length > 0) {
      try {
        const fresh = await computeBtcMarkets();
        for (const fm of fresh.markets) {
          const sideProb = fm.side === "YES" ? fm.modelYesProb : 1 - fm.modelYesProb;
          freshProbBySide.set(`${fm.ticker}|${fm.side}`, sideProb);
        }
      } catch (e: any) {
        skipReasons.push(`entry-recheck: unavailable (${e?.message?.slice(0, 60) ?? "err"}) — skipping guard`);
        freshProbBySide = new Map();
      }
    }

    // Configurable max-entry ceiling (live only). Read once per run from
    // auto_odds_settings; default 78¢ if unset. Panel exposes this so the
    // user can raise/lower the recovery-ratio cutoff without a redeploy.
    let liveMaxEntryCents = 78;
    // auto_button_type controls whether the Kalshi-lean primary override runs.
    // "odds_bet" → override active (follow Kalshi favorite leg).
    // "model_bet" → override OFF, always use model's value-pick side.
    let autoButtonType: "odds_bet" | "model_bet" = "odds_bet";
    try {
      const { data: settingsRow } = await (supabase as any)
        .from("auto_odds_settings")
        .select("max_entry_cents, auto_button_type")
        .eq("user_id", userId)
        .maybeSingle();
      const raw = Number((settingsRow as { max_entry_cents?: number } | null)?.max_entry_cents);
      if (isLive && data.maxEntryCents != null) {
        liveMaxEntryCents = data.maxEntryCents;
      } else if (isLive && Number.isFinite(raw) && raw >= 50 && raw <= 95) {
        liveMaxEntryCents = raw;
      }
      const bt = (settingsRow as { auto_button_type?: string } | null)?.auto_button_type;
      if (bt === "model_bet") autoButtonType = "model_bet";
    } catch { /* fall back to defaults */ }

    // Model Bet entries are capped at 75¢ regardless of user setting.
    if (autoButtonType === "model_bet" && isLive) {
      liveMaxEntryCents = Math.min(liveMaxEntryCents, 75);
    }




    // ── Expand each candidate into 1 primary + optional model-side probe ──
    // Primary side = whichever leg Kalshi prices as favorite. If model
    // disagrees with Kalshi's lean, also fire a small model-side probe.
    type PlanEntry = {
      m: typeof candidates[number];
      side: "YES" | "NO";
      stakeUsd: number;
      kind: "primary" | "kalshi_primary_disagree" | "model_probe";
    };
    const plan: PlanEntry[] = [];
    for (const m of candidates) {
      const yp = m.yesPrice;

      // Model-bet mode OR any caller-forced side (Model Bet UI passes
      // forceSide): Kalshi-lean override is OFF. Always follow the model's
      // value-pick side (m.side, already set to forceSide upstream). No
      // disagreement branch, no probe. Kalshi lean applies to Odds-Bet only.
      if (autoButtonType === "model_bet" || data.forceSide) {
        // Always follow the LIVE model direction (raw P(YES) + chart/anchor),
        // not the first-snapshot m.side which can be stale/inverted. When a
        // caller passes forceSide (Model Bet UI), honor it verbatim.
        const modelSide: "YES" | "NO" = data.forceSide
          ? m.side
          : (m.liveSide ?? (m.modelYesProb >= 0.5 ? "YES" : "NO"));
        plan.push({ m, side: modelSide, stakeUsd: data.stakeUsd, kind: "primary" });
        continue;
      }

      // Odds-bet mode: original Kalshi-leaned primary logic.
      let kalshiSide: "YES" | "NO" | null = null;
      if (yp >= KALSHI_LEAN_THRESHOLD) kalshiSide = "YES";
      else if (yp <= 1 - KALSHI_LEAN_THRESHOLD) kalshiSide = "NO";
      // Probe side = LIVE model direction (raw P(YES) + chart verdict + anchor
      // drift, may flip mid-window). Falls back to raw P(YES) direction on
      // older market feeds that pre-date liveSide. Historically ~87% accurate.
      const rawModelSide: "YES" | "NO" =
        m.liveSide ?? (m.modelYesProb >= 0.5 ? "YES" : "NO");
      if (kalshiSide === null || kalshiSide === rawModelSide) {
        // Coinflip zone or agreement → single bet on Kalshi lean (or model
        // value-pick when Kalshi is in the coinflip zone, preserving today's
        // fallback behavior).
        const singleSide = kalshiSide ?? m.side;
        plan.push({ m, side: singleSide, stakeUsd: data.stakeUsd, kind: "primary" });
      } else {
        // Disagreement → primary on Kalshi lean only. Model-side probe
        // DISABLED per user request (was betting the reverse side and
        // losing). Do not re-enable without explicit user approval.
        plan.push({ m, side: kalshiSide, stakeUsd: data.stakeUsd, kind: "kalshi_primary_disagree" });
        const rawEdgePts = Math.abs(m.modelYesProb - yp) * 100;
        const flipTag = m.liveFlipped ? " (chart-flipped)" : "";
        skipReasons.push(`${m.ticker}: disagree — Kalshi leans ${kalshiSide} @ ${(yp * 100).toFixed(0)}¢, live model picks ${rawModelSide}${flipTag} (edge ${rawEdgePts.toFixed(1)}pts) → $${data.stakeUsd} ${kalshiSide} only (probe disabled)`);
      }

    }


    // ── Duplicate-fire guard (15-minute window) ──
    // Skip a ticker if this user already placed an auto_trade_orders row
    // for it in the last 15 minutes (any status). Fires everywhere else —
    // this only blocks the ~seconds-apart duplicate seen on the same market.
    const recentTickers15m = new Set<string>();
    try {
      const cutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: recentRows } = await supabase
        .from("auto_trade_orders")
        .select("ticker")
        .eq("user_id", userId)
        .gte("created_at", cutoffIso);
      for (const r of (recentRows ?? []) as Array<{ ticker: string }>) {
        recentTickers15m.add(r.ticker);
      }
    } catch { /* if the read fails, fall through */ }

    const placed: AutoTradeOrderRow[] = [];
    for (const entry of plan) {
      const { m, side, stakeUsd: sizedStake, kind } = entry;
      if (recentTickers15m.has(m.ticker)) {
        skipReasons.push(`${m.ticker}: duplicate — already placed within last 15 min`);
        continue;
      }


      if (!data.force && freshProbBySide.size > 0 && kind !== "kalshi_primary_disagree") {
        // Skip the model-direction recheck for the Kalshi-primary leg on
        // disagreement — by definition the model doesn't back that side.
        const p = freshProbBySide.get(`${m.ticker}|${side}`);
        if (p === undefined) {
          skipReasons.push(`${m.ticker}: entry-recheck — ${side} no longer in fresh market list`);
          continue;
        }
        if (p < LIVE_FLIP_PROB) {
          skipReasons.push(`${m.ticker}: entry-recheck — model now ${(p * 100).toFixed(0)}% for ${side} (< ${LIVE_FLIP_PROB * 100}%)`);
          continue;
        }
      }
      const limitCents = Math.max(1, Math.min(99, Math.round(
        (side === "YES" ? (m.yesAsk || m.yesPrice) : (m.noAsk || (1 - m.yesPrice))) * 100,
      )));
      // ── Max-entry ceiling (live only, configurable) ──
      // Above this, one loss costs many wins to claw back. Default 78¢ —
      // user can raise up to 95¢ via the Odds Shadow Trader panel.
      if (isLive && limitCents > liveMaxEntryCents) {
        skipReasons.push(`${m.ticker}: ${side} ${limitCents}¢ > ${liveMaxEntryCents}¢ ceiling — skipped`);
        continue;
      }
      // ── Sub-edge regime gate (LIVE only, Odds-Bet only) ──
      // 30-day ROI-by-bucket analysis: only entry ≥76¢ AND side_prob ≥0.70
      // is net-positive for the Odds-Bet path. Model Bet bypasses this gate
      // per user request: fire on every new model prediction up to the 75¢
      // ceiling enforced above, regardless of side_prob.
      if (isLive && autoButtonType !== "model_bet") {
        const sideProb = side === "YES" ? m.modelYesProb : (1 - m.modelYesProb);
        if (limitCents < 76 || sideProb < 0.70) {
          skipReasons.push(`${m.ticker}: sub_edge_regime — ${side} ${limitCents}¢ / prob ${(sideProb * 100).toFixed(0)}% (need ≥76¢ & ≥70%)`);
          continue;
        }
      }

      // ── Polymarket telemetry (live only, non-blocking) ──
      // Record Polymarket's 5-min BTC Up/Down snapshot for study only.
      // It must never block an odds-bet entry or add a misleading skip reason.
      let polymarketSnap: {
        upProb: number;
        downProb: number;
        ourSideProb: number;
        agrees: boolean;
        slug: string;
        windowStartMs: number;
        windowEndMs: number;
      } | null = null;
      if (isLive) {
        try {
          const { getPolymarketBtcUpDown } = await import("./polymarketOdds");
          const poly = await getPolymarketBtcUpDown();
          if (poly) {
            const ourSideProb = side === "YES" ? poly.upProb : poly.downProb;
            const agrees = ourSideProb >= 0.5;
            polymarketSnap = {
              upProb: poly.upProb,
              downProb: poly.downProb,
              ourSideProb,
              agrees,
              slug: poly.slug,
              windowStartMs: poly.windowStartMs,
              windowEndMs: poly.windowEndMs,
            };
            // Fire-and-forget tape log — never blocks the trade.
            void (async () => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from("polymarket_btc_tape").insert({
                  user_id: userId,
                  window_start: new Date(poly.windowStartMs).toISOString(),
                  up_prob: poly.upProb,
                  down_prob: poly.downProb,
                  slug: poly.slug,
                  kalshi_ticker: m.ticker,
                  kalshi_side: side,
                  kalshi_our_side_cents: limitCents,
                  agrees,
                });
              } catch { /* noop */ }
            })();
          }
        } catch (e: any) {
          void e;
        }
      }


      // Stake for this plan entry (primary = ladder stake, probe = $10/$20).
      const contracts = Math.max(1, Math.floor((sizedStake * 100) / limitCents));
      const stakeActual = (contracts * limitCents) / 100;

      let kalshiOrderId: string | null = null;
      // Default to the intended size/price. If we actually go live, these get
      // overwritten with the true IOC fill result before we insert the row.
      let filledContracts = contracts;
      let filledEntryCents = limitCents;
      // Ladder telemetry: recorded on the auto_trade_orders.inputs_snapshot
      // so the dashboard widget can compute success rate, avg climb, and P&L.
      let ladderTelemetry: {
        attempts: number;
        startedCents: number;
        filledCents: number | null;
        climbedCents: number | null;
        filled: boolean;
        hardCapped: boolean;
      } = {
        attempts: 1,
        startedCents: limitCents,
        filledCents: null,
        climbedCents: null,
        filled: false,
        hardCapped: false,
      };
      if (isLive) {

        // IOC retry ladder: on 0-fill, bump limit by 1¢ and retry. Stays
        // within the odds-bet hard cap (89¢ = -750 American). Non-force
        // (model-driven) entries also allowed to nudge up to 89¢ so we don't
        // sit chasing a stale ask. Max 3 retries (4 attempts total).
        const HARD_CAP_CENTS = 89;
        const MAX_RETRIES = 3;
        let attemptCents = limitCents;
        let attempt = 0;
        let ladderNote = "";
        let filledOk = false;
        while (attempt <= MAX_RETRIES) {
          if (attemptCents > HARD_CAP_CENTS) {
            ladderNote = `stopped at ${attemptCents}¢ (>${HARD_CAP_CENTS}¢ cap)`;
            ladderTelemetry.hardCapped = true;
            break;
          }
          const attemptContracts = Math.max(1, Math.floor((sizedStake * 100) / attemptCents));
          try {
            const { submitKalshiBuy } = await import("./cryptoTrades.functions");
            const out = await submitKalshiBuy(supabase, userId, {
              ticker: m.ticker,
              eventTicker: m.eventTicker ?? undefined,
              side: side,
              contracts: attemptContracts,
              limitPriceCents: attemptCents,
              strike: m.strike,
              spot: m.spot,
              modelProb: m.modelYesProb,
              marketYesPrice: m.yesPrice,
              edgePts: m.edgePts,
              stakeUsd: (attemptContracts * attemptCents) / 100,
              closeTime: m.closeTime ?? undefined,
              inputsSnapshot: {
                source: "auto_trade",
                sigmaDistance: m.sigmaDistance,
                gateAction: m.gateAction,
                momentumAlignsWithSide: m.gapAnalysis?.momentumAlignsWithSide,
                effectiveEdgePts: m.edgePts,
                convictionMult: 1,
                minSigma,
                minEdgePts,
                equityAdjust: equity?.btcImpact?.edgeAdjustPts ?? null,
                equityBlock: equity?.btcImpact?.wouldBlock ?? null,
                yesAsk: m.yesAsk ?? null,
                noAsk: m.noAsk ?? null,
                secondsToClose: m.secondsToClose,
                firedAt: new Date().toISOString(),
                iocLadderAttempt: attempt,
                iocLadderStartCents: limitCents,
                iocLadderCents: attemptCents,
              },
            });
            kalshiOrderId = out.orderId;
            if (out.fillCount && out.fillCount > 0) {
              filledContracts = out.fillCount;
              filledEntryCents = out.filledCents || attemptCents;
              filledOk = true;
              ladderTelemetry.attempts = attempt + 1;
              ladderTelemetry.filledCents = filledEntryCents;
              ladderTelemetry.climbedCents = filledEntryCents - limitCents;
              ladderTelemetry.filled = true;
              if (attempt > 0) {
                ladderNote = `filled on retry ${attempt} @ ${filledEntryCents}¢ (started ${limitCents}¢)`;
              }
              break;
            }
            // 0-fill: step up 1¢ and try again.
            ladderNote = `IOC 0-fill @ ${attemptCents}¢ (attempt ${attempt + 1})`;
            attempt += 1;
            attemptCents += 1;
          } catch (e: any) {
            skipReasons.push(`${m.ticker}: kalshi order failed — ${e?.message ?? String(e)}`);
            break;
          }
        }
        if (!filledOk) {
          ladderTelemetry.attempts = attempt + 1;
          // Log the exhausted ladder attempt so the widget can show
          // failure rate even when no order row is created.
          try {
            await supabase.from("auto_odds_study_log").insert({
              user_id: userId,
              ticker: m.ticker,
              window_start_at: new Date().toISOString(),
              seconds_to_close: m.secondsToClose,
              yes_cents: m.yesAsk ?? null,
              no_cents: m.noAsk ?? null,
              entered: false,
              note: `ioc_ladder_exhausted:${JSON.stringify(ladderTelemetry)}`,
            });
          } catch {}
          skipReasons.push(`${m.ticker}: ${ladderNote || `IOC ladder exhausted from ${limitCents}¢`}`);
          continue;
        }
        if (ladderNote && attempt > 0) {
          skipReasons.push(`${m.ticker}: ${ladderNote}`);
        }
      }



      const stakeFilled = (filledContracts * filledEntryCents) / 100;

      // Attach the most-recent jump features (if any) recorded for this ticker
      // so we have a per-order audit trail of what the pre-buy market looked
      // like. Read-only — does not affect the buy decision.
      let jumpSnap: unknown = null;
      try {
        const { data: jf } = await supabase
          .from("btc_model_predictions")
          .select("jump_features")
          .eq("ticker", m.ticker)
          .maybeSingle();
        jumpSnap = (jf as any)?.jump_features ?? null;
      } catch { /* non-fatal */ }

      const { data: row, error } = await supabase
        .from("auto_trade_orders")
        .insert({
          user_id: userId,
          session_id: sessionId,
          mode: isLive ? "live" : "paper",
          ticker: m.ticker,
          event_ticker: m.eventTicker,
          side: side,
          stake_usd: stakeFilled,
          limit_cents: limitCents,
          contracts: filledContracts,
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
          entry_price_cents: filledEntryCents,
          contracts_remaining: filledContracts,
          partial_pnl_usd: 0,
          exit_ladder: DEFAULT_EXIT_LADDER as any,
          is_martingale: false,
          inputs_snapshot: { iocLadder: ladderTelemetry, polymarket: polymarketSnap, planKind: kind, modelSide: m.side, kalshiLeanYesPrice: m.yesPrice, jump: jumpSnap } as any,


        })
        .select("id, ticker, side, stake_usd, contracts, limit_cents, status, mode, model_prob, edge_pts, sigma_distance, close_time, pnl_usd, settle_price, created_at, entry_price_cents, contracts_remaining, partial_pnl_usd")
        .single();

      if (error) { skipReasons.push(`${m.ticker}: insert error ${error.message}`); continue; }
      if (row) { placed.push(row as AutoTradeOrderRow); recentTickers15m.add(m.ticker); }
    }



    return {
      sessionId, mode: data.mode,
      attempted: plan.length,
      placed: placed.length,
      skipped: skipReasons.length,
      skipReasons: skipReasons.slice(0, 20),
      orders: placed,
    };
}


export const listAutoTradeOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders: AutoTradeOrderRow[]; totals: { placed: number; wins: number; losses: number; pnlUsd: number } }> => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, stake_usd, contracts, limit_cents, status, mode, model_prob, edge_pts, sigma_distance, close_time, pnl_usd, settle_price, created_at, entry_price_cents, contracts_remaining, partial_pnl_usd")
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
    const { fetchKalshiSettlement } = await import("@/lib/kalshiSettle");
    for (const o of pending) {
      // Kalshi is the source of truth. Fall back to internal spot only if
      // Kalshi hasn't finalized yet.
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
      const { error } = await supabase
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
    return { settled };
  });

// ── STEP 9 · Auto-Exit Live Positions ─────────────────────────────────────
// Combined exit policy for live auto-trade orders, evaluated every minute:
//   • Take-profit: mark PnL ≥ +80% of stake → close at current bid
//   • Stop-loss:   mark PnL ≤ -75% of stake → close at current bid
//   • Edge decay:  price moved ≥2¢ against our side → close at current bid
// Paper orders and manual crypto_trades are untouched. Settlement still
// happens via settleAutoTradeOrders for any position not exited early.
const LIVE_TP_FRAC = 0.80;
const LIVE_SL_FRAC = 0.75;
const LIVE_EDGE_DECAY_CENTS = 2;
// Direction-flip: if the live model now gives our side < this prob, bail out
// instead of riding a losing conviction into expiry. 0.45 = model has rotated
// meaningfully against us (from >0.5 at entry).
const LIVE_FLIP_PROB = 0.45;
const KALSHI_PUBLIC_BASE = "https://api.elections.kalshi.com/trade-api/v2";


// Shared exit engine. Works with any supabase client (RLS-scoped or admin)
// and any userId. Handles BOTH `paper` and `live` orders:
//   • Live rows: real Kalshi IOC sell (requires signing keys).
//   • Paper rows: mark-to-market "fill" at current bid/ask, no external order.
// Removed the KALSHI_LIVE_ENABLED gate so paper positions get mid-trade exits
// (ladder, TP, SL, flip, edge-decay, net-lock) just like live ones.
export async function autoExitForUser(
  supabase: any,
  userId: string,
): Promise<{ exited: number; reasons: string[] }> {
  const reasons: string[] = [];
  const liveEnabled = process.env.KALSHI_LIVE_ENABLED === "true";

  // Model-Bet-only simple exit rules: +20¢ absolute TP and ×0.30 entry SL.
  // These fire earlier than the standard ladder for users on model_bet.
  const { data: btSettings } = await supabase
    .from("auto_odds_settings")
    .select("auto_button_type, exit_tp_frac, exit_sl_frac, exit_late_sl_frac, exit_edge_decay_cents, exit_flip_prob, exit_odds_flip_cents")
    .eq("user_id", userId)
    .maybeSingle();
  const isModelBetUser = (btSettings?.auto_button_type ?? "") === "model_bet";
  // Per-user exit thresholds (fall back to module defaults if unset).
  const cfgTpFrac = Number(btSettings?.exit_tp_frac ?? LIVE_TP_FRAC) || LIVE_TP_FRAC;
  const cfgSlFrac = Number(btSettings?.exit_sl_frac ?? LIVE_SL_FRAC) || LIVE_SL_FRAC;
  const cfgLateSlFrac = Number(btSettings?.exit_late_sl_frac ?? LIVE_LATE_SL_FRAC) || LIVE_LATE_SL_FRAC;
  const cfgEdgeDecayCents = Number(btSettings?.exit_edge_decay_cents ?? LIVE_EDGE_DECAY_CENTS) || LIVE_EDGE_DECAY_CENTS;
  const cfgFlipProb = Number(btSettings?.exit_flip_prob ?? LIVE_FLIP_PROB) || LIVE_FLIP_PROB;
  const cfgOddsFlipCents = Number(btSettings?.exit_odds_flip_cents ?? 12) || 12;


  const nowIso = new Date().toISOString();
  const { data: open } = await supabase
    .from("auto_trade_orders")
    .select("id, ticker, side, mode, stake_usd, contracts, limit_cents, close_time, entry_price_cents, contracts_remaining, partial_pnl_usd, exit_ladder, is_martingale, inputs_snapshot")
    .eq("user_id", userId)
    .in("mode", ["paper", "live"])
    .eq("status", "placed")
    .gt("close_time", nowIso)
    .limit(50);

  type Row = {
    id: string; ticker: string; side: "YES" | "NO"; mode: "paper" | "live";
    stake_usd: number; contracts: number; limit_cents: number; close_time: string;
    entry_price_cents: number | null; contracts_remaining: number | null;
    partial_pnl_usd: number | null; exit_ladder: any; is_martingale: boolean | null;
    inputs_snapshot: any;
  };
  const rows = (open ?? []) as Row[];
  if (!rows.length) return { exited: 0, reasons: [] };

  // Fresh Polymarket read (once per tick, cached 10s inside the module).
  // If unavailable, poly_flip is skipped this tick — existing exits still fire.
  let polyNow: { upProb: number; downProb: number; slug: string; windowStartMs: number; windowEndMs: number } | null = null;
  try {
    const { getPolymarketBtcUpDown } = await import("./polymarketOdds");
    polyNow = await getPolymarketBtcUpDown();
  } catch { polyNow = null; }


  // Fresh model read for flip detection.
  const currentModelProbBySide = new Map<string, number>();
  try {
    const fresh = await computeBtcMarkets();
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

  // Sell helper. Live → real Kalshi IOC. Paper → simulated fill at sellCents.
  async function trySell(r: Row, contractsToSell: number, sellCents: number, tag: string): Promise<{ fillCount: number; filledCents: number } | null> {
    if (r.mode === "paper") {
      return { fillCount: contractsToSell, filledCents: sellCents };
    }
    if (!liveEnabled) {
      reasons.push(`${r.ticker}: live sell skipped — KALSHI_LIVE_ENABLED not true`);
      return null;
    }
    try {
      const { signKalshi } = await import("./cryptoTrades.functions");
      const path = "/portfolio/events/orders";
      const headers = await signKalshi("POST", path, userId);
      const priceDollars = (r.side === "YES" ? sellCents : 100 - sellCents) / 100;
      const body = {
        ticker: r.ticker,
        action: "sell",
        side: r.side === "YES" ? "ask" : "bid",
        type: "limit",
        count: String(contractsToSell),
        price: priceDollars.toFixed(4),
        time_in_force: "immediate_or_cancel",
        self_trade_prevention_type: "taker_at_cross",
        client_order_id: `${tag}-${r.id}-${Date.now()}`.slice(0, 64),
      };
      const res = await fetch(`${KALSHI_PUBLIC_BASE}${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        reasons.push(`${r.ticker}: sell failed — ${j?.error?.message ?? `http ${res.status}`}`);
        return null;
      }
      const fillCount = Number(j?.order?.fill_count ?? j?.fill_count ?? 0);
      const avgFillDollars = Number(j?.order?.average_fill_price ?? j?.average_fill_price ?? 0);
      if (!Number.isFinite(fillCount) || fillCount <= 0) {
        reasons.push(`${r.ticker}: sell 0-fill (IOC) @ ${sellCents}¢`);
        return null;
      }
      const filledCents = avgFillDollars > 0
        ? Math.round(avgFillDollars * (r.side === "YES" ? 100 : -100) + (r.side === "YES" ? 0 : 100))
        : sellCents;
      return { fillCount, filledCents };
    } catch (e: any) {
      reasons.push(`${r.ticker}: sell err ${e?.message ?? "x"}`);
      return null;
    }
  }

  type Marked = { r: Row; markCents: number; markPnl: number; remaining: number; entry: number };
  const marked: Marked[] = [];
  for (const r of rows) {
    const remaining = r.contracts_remaining ?? r.contracts;
    const entry = r.entry_price_cents ?? r.limit_cents;
    if (remaining <= 0) continue;
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
    const markPnl = ((markCents - entry) / 100) * remaining;
    marked.push({ r, markCents, markPnl, remaining, entry });
  }

  let exited = 0;
  const handledIds = new Set<string>();

  // Hard price floor: if our side has crashed to ≤25¢, close 100% immediately.
  // Backtest against 131 settled live trades: floor at 25¢ saved $228 on 8 big
  // losses and cost only $130 across 112 wins (1 win of 112 ever touched 25¢).
  // Runs BEFORE ladder logic so it always wins over per-order exit tiers.
  // Bold/strict floor: was 25¢ — bumped so a crash exits at 35 instead of 1.
  const HARD_FLOOR_CENTS = 35;

  for (const mk of marked) {
    const { r, markCents, entry, remaining } = mk;
    const ladder = Array.isArray(r.exit_ladder) ? (r.exit_ladder as ExitLadderTier[]) : DEFAULT_EXIT_LADDER;
    const delta = markCents - entry;

    const hardFloorHit = markCents <= HARD_FLOOR_CENTS;

    const triggered = ladder.filter(t => {
      if (t.kind === "sl") return delta <= t.priceDeltaCents;
      return delta >= t.priceDeltaCents;
    });
    if (!hardFloorHit && triggered.length === 0) continue;


    triggered.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "sl" ? -1 : 1;
      return b.exitFraction - a.exitFraction;
    });
    // Hard floor overrides any ladder tier: full 100% exit at mark.
    const tier: ExitLadderTier = hardFloorHit
      ? { kind: "sl", priceDeltaCents: delta, exitFraction: 1.0, label: `HARD FLOOR ≤${HARD_FLOOR_CENTS}¢` }
      : triggered[0];
    const toSell = Math.max(1, Math.min(remaining, Math.floor(remaining * tier.exitFraction)));

    const { data: claimed } = await supabase
      .from("auto_trade_orders")
      .update({ status: "closing" })
      .eq("id", r.id)
      .eq("status", "placed")
      .select("id")
      .maybeSingle();
    if (!claimed) { reasons.push(`${r.ticker}: ladder claim lost`); continue; }

    const sellCents = Math.max(1, Math.min(99, markCents));
    let fill = await trySell(r, toSell, sellCents, hardFloorHit ? "hard-floor" : `ladder-${tier.kind}`);

    // Bold/strict: on SL/hard-floor IOC 0-fill, chase price down once at
    // mark-2¢ so a moving book doesn't leave the exit hanging until next tick.
    if (!fill && (tier.kind === "sl" || hardFloorHit)) {
      const chaseCents = Math.max(1, Math.min(99, markCents - 2));
      if (chaseCents < sellCents) {
        fill = await trySell(r, toSell, chaseCents, hardFloorHit ? "hard-floor-chase" : `ladder-sl-chase`);
        if (fill) reasons.push(`${r.ticker}: SL chase filled @ ${chaseCents}¢ after 0-fill @ ${sellCents}¢`);
      }
    }

    if (!fill) {
      await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", r.id);
      continue;
    }

    const priorPartial = Number(r.partial_pnl_usd ?? 0);
    const tierPnl = ((fill.filledCents - entry) / 100) * fill.fillCount;
    const newPartial = priorPartial + tierPnl;
    const newRemaining = Math.max(0, remaining - fill.fillCount);
    const fullyClosed = newRemaining === 0;

    if (fullyClosed) {
      const totalPnl = newPartial;
      await supabase
        .from("auto_trade_orders")
        .update({
          status: totalPnl > 0 ? "settled_win" : "settled_loss",
          settle_price: fill.filledCents / 100,
          pnl_usd: totalPnl,
          partial_pnl_usd: newPartial,
          contracts_remaining: 0,
          settled_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      exited++;
      handledIds.add(r.id);
      reasons.push(`${r.ticker}[${r.mode}]: ${tier.label} FULL close ${fill.fillCount}@${fill.filledCents}¢ · total pnl $${totalPnl.toFixed(2)}`);
    } else {
      await supabase
        .from("auto_trade_orders")
        .update({
          status: "placed",
          partial_pnl_usd: newPartial,
          contracts_remaining: newRemaining,
        })
        .eq("id", r.id);
      handledIds.add(r.id);
      reasons.push(`${r.ticker}[${r.mode}]: ${tier.label} partial ${fill.fillCount}/${remaining}@${fill.filledCents}¢ (rem ${newRemaining}, banked $${newPartial.toFixed(2)})`);
      mk.remaining = newRemaining;
      mk.markPnl = ((markCents - entry) / 100) * newRemaining;
    }
  }

  const stillOpen = marked.filter(m => !handledIds.has(m.r.id) && m.remaining > 0);
  const totalUnrealized = stillOpen.reduce((s, x) => s + x.markPnl, 0);
  const netLock = stillOpen.length > 0 && totalUnrealized > 0;
  if (netLock) {
    reasons.push(`net_lock: aggregate +$${totalUnrealized.toFixed(2)} across ${stillOpen.length} open — closing all`);
  }

  for (const { r, markCents, markPnl, remaining, entry } of stillOpen) {
    const tpThreshold = cfgTpFrac * Number(r.stake_usd);
    const secondsLeft = Math.max(0, (Date.parse(r.close_time) - Date.now()) / 1000);
    const slFrac = secondsLeft < LIVE_LATE_TIGHTEN_SEC ? cfgLateSlFrac : cfgSlFrac;
    const slThreshold = -slFrac * Number(r.stake_usd);
    const adverseCents = entry - markCents;
    const sideProbNow = currentModelProbBySide.get(r.ticker);

    let exitReason: "tp" | "sl" | "edge" | "net" | "flip" | "mart_hopeless" | "mart_hardcap" | "odds_flip" | "deep_combo" | "poly_flip" | null = null;
    // Martingale-specific rules (only apply to martingale-tagged orders).
    if (r.is_martingale === true) {
      const stake = Number(r.stake_usd);
      const lossFrac = stake > 0 ? -markPnl / stake : 0; // 0..1+
      // Hard cap: any martingale trade down ≥35% → exit immediately.
      if (lossFrac >= 0.35) {
        exitReason = "mart_hardcap";
        reasons.push(`${r.ticker}[mart]: HARD CAP — down ${(lossFrac * 100).toFixed(0)}% of $${stake} stake`);
      }
      // Hopeless: model side prob <15% AND already down ≥25%.
      else if (sideProbNow !== undefined && sideProbNow < 0.15 && lossFrac >= 0.25) {
        exitReason = "mart_hopeless";
        reasons.push(`${r.ticker}[mart]: HOPELESS — model ${(sideProbNow * 100).toFixed(0)}% on ${r.side}, down ${(lossFrac * 100).toFixed(0)}%`);
      }
    }
    // Deep-drawdown combo: ANY order (mart or regular) that's down ≥70% AND
    // both trend (model prob) and odds (Kalshi mark) are against us → sell.
    // Backstop for cases where 35% hard cap / 50% SL didn't fill.
    if (!exitReason) {
      const stake = Number(r.stake_usd);
      const lossFrac = stake > 0 ? -markPnl / stake : 0;
      const trendAgainst = sideProbNow !== undefined && sideProbNow < 0.40;
      const oddsAgainst = (entry - markCents) >= 10;
      if (lossFrac >= 0.70 && trendAgainst && oddsAgainst) {
        exitReason = "deep_combo";
        reasons.push(`${r.ticker}[${r.mode}]: DEEP COMBO — down ${(lossFrac * 100).toFixed(0)}%, model ${((sideProbNow ?? 0) * 100).toFixed(0)}% for ${r.side}, Kalshi ${markCents}¢ vs entry ${entry}¢`);
      }
    }

    // Kalshi-odds flip: the market moved ≥cfgOddsFlipCents against our side vs entry
    // (independent of our model). Configurable per user (default 12¢).
    if (!exitReason && (entry - markCents) >= cfgOddsFlipCents) {
      exitReason = "odds_flip";
      reasons.push(`${r.ticker}[${r.mode}]: ODDS FLIP — Kalshi ${r.side} ${markCents}¢ vs entry ${entry}¢ (−${entry - markCents}¢)`);
    }
    // Late-window emergency: <180s left AND our side ≤ 40¢ → force close now.
    // Prevents rides into settlement when price has clearly rotated against us.
    if (!exitReason && secondsLeft < LIVE_LATE_TIGHTEN_SEC && markCents <= 40) {
      exitReason = "sl";
      reasons.push(`${r.ticker}[${r.mode}]: LATE EMERGENCY — ${secondsLeft.toFixed(0)}s left, mark ${markCents}¢ ≤ 40¢`);
    }
    // Polymarket flip: crowd on same 5-min window has rotated against us.
    // Fires only when BOTH: our-side Poly prob < 40% now AND dropped ≥15pts
    // vs entry snapshot. Same-window guard prevents comparing across expiries.
    if (!exitReason && polyNow) {
      const entryPoly = r.inputs_snapshot?.polymarket;
      const entryOurSide = Number(entryPoly?.ourSideProb);
      const entryWinStart = Number(entryPoly?.windowStartMs);
      const nowOurSide = r.side === "YES" ? polyNow.upProb : polyNow.downProb;
      if (Number.isFinite(entryOurSide) && Number.isFinite(entryWinStart)
          && entryWinStart === polyNow.windowStartMs
          && nowOurSide < 0.40
          && (entryOurSide - nowOurSide) >= 0.15) {
        exitReason = "poly_flip";
        reasons.push(`${r.ticker}[${r.mode}]: POLY FLIP — Polymarket ${r.side === "YES" ? "Up" : "Down"} ${(nowOurSide * 100).toFixed(0)}% (entry ${(entryOurSide * 100).toFixed(0)}%, −${((entryOurSide - nowOurSide) * 100).toFixed(0)}pts)`);
      }
    }
    // Model-Bet simple exits: +20¢ absolute profit target and ×0.30 stop.
    // Fires earlier than the generic ladder for model_bet users only.
    if (!exitReason && isModelBetUser && (markCents - entry) >= 20) {
      exitReason = "tp";
      reasons.push(`${r.ticker}[${r.mode}][model_bet]: +20¢ TP — mark ${markCents}¢ vs entry ${entry}¢`);
    }
    if (!exitReason && isModelBetUser && entry > 0 && markCents <= Math.floor(entry * 0.30)) {
      exitReason = "sl";
      reasons.push(`${r.ticker}[${r.mode}][model_bet]: ×0.30 SL — mark ${markCents}¢ ≤ ${Math.floor(entry * 0.30)}¢ (entry ${entry}¢)`);
    }
    // Model-Bet time-based force exit: mark ≤ 25¢ sustained for ≥3 min.
    // Tracks first sub-25¢ tick in inputs_snapshot.sub25SinceMs; clears on recovery.
    if (!exitReason && isModelBetUser) {
      const snap = (r.inputs_snapshot ?? {}) as Record<string, unknown>;
      const since = Number(snap.sub25SinceMs);
      if (markCents <= 25) {
        if (Number.isFinite(since)) {
          const heldMs = Date.now() - since;
          if (heldMs >= 180_000) {
            exitReason = "sl";
            reasons.push(`${r.ticker}[${r.mode}][model_bet]: FORCE — mark ${markCents}¢ ≤ 25¢ for ${Math.floor(heldMs / 1000)}s`);
          }
        } else {
          await supabase
            .from("auto_trade_orders")
            .update({ inputs_snapshot: { ...snap, sub25SinceMs: Date.now() } })
            .eq("id", r.id);
        }
      } else if (Number.isFinite(since)) {
        const { sub25SinceMs: _drop, ...rest } = snap;
        await supabase
          .from("auto_trade_orders")
          .update({ inputs_snapshot: rest })
          .eq("id", r.id);
      }
    }



    if (!exitReason && sideProbNow !== undefined && sideProbNow < cfgFlipProb) {
      exitReason = "flip";
      reasons.push(`${r.ticker}[${r.mode}]: flip — model now ${(sideProbNow * 100).toFixed(0)}% for ${r.side} (< ${(cfgFlipProb * 100).toFixed(0)}%)`);
    }

    else if (!exitReason && netLock) exitReason = "net";
    else if (!exitReason && markPnl >= tpThreshold) exitReason = "tp";
    else if (!exitReason && markPnl <= slThreshold) exitReason = "sl";
    else if (!exitReason && adverseCents >= cfgEdgeDecayCents) exitReason = "edge";
    if (!exitReason) continue;

    const { data: claimed } = await supabase
      .from("auto_trade_orders")
      .update({ status: "closing" })
      .eq("id", r.id)
      .eq("status", "placed")
      .select("id")
      .maybeSingle();
    if (!claimed) { reasons.push(`${r.ticker}: claim lost`); continue; }

    const sellCents = Math.max(1, Math.min(99, markCents));
    const fill = await trySell(r, remaining, sellCents, `auto-exit-${exitReason}`);
    if (!fill) {
      await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", r.id);
      continue;
    }

    const priorPartial = Number(r.partial_pnl_usd ?? 0);
    const tailPnl = ((fill.filledCents - entry) / 100) * fill.fillCount;
    const totalPnl = priorPartial + tailPnl;
    const newRemaining = Math.max(0, remaining - fill.fillCount);
    const fullyClosed = newRemaining === 0;

    await supabase
      .from("auto_trade_orders")
      .update(fullyClosed ? {
        status: totalPnl > 0 ? "settled_win" : "settled_loss",
        settle_price: fill.filledCents / 100,
        pnl_usd: totalPnl,
        partial_pnl_usd: priorPartial + tailPnl,
        contracts_remaining: 0,
        settled_at: new Date().toISOString(),
      } : {
        status: "placed",
        partial_pnl_usd: priorPartial + tailPnl,
        contracts_remaining: newRemaining,
      })
      .eq("id", r.id);
    if (fullyClosed) exited++;
    reasons.push(`${r.ticker}[${r.mode}]: ${exitReason} ${fullyClosed ? "closed" : "partial"} ${fill.fillCount}/${remaining} @ ${fill.filledCents}¢ (pnl $${totalPnl.toFixed(2)})`);
  }

  return { exited, reasons: reasons.slice(0, 30) };
}

export const autoExitLivePositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ exited: number; reasons: string[] }> => {
    const { supabase, userId } = context;
    return autoExitForUser(supabase, userId);
  });

// ── Targeted market sell for a single auto_trade_orders row ──────────────
// Used by the Odds-Bet whipsaw exit on the client. Sells the row's remaining
// contracts at current market bid via a Kalshi IOC. Updates row status and
// pnl using the same conventions as autoExitForUser.
export const sellOddsBetOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string; reason?: string }) => {
    if (!data?.orderId || typeof data.orderId !== "string") throw new Error("orderId required");
    return { orderId: data.orderId, reason: data.reason ?? "whipsaw_exit" };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string; pnlUsd?: number }> =>
    sellOddsBetCore(context.supabase as SupabaseClient, context.userId, data.orderId, data.reason),
  );

export async function sellOddsBetCore(
  supabase: SupabaseClient,
  userId: string,
  orderId: string,
  reason: string = "whipsaw_exit",
): Promise<{ ok: boolean; message: string; pnlUsd?: number }> {
    const data = { orderId, reason };
    const liveEnabled = process.env.KALSHI_LIVE_ENABLED === "true";



    const { data: row, error: rErr } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, mode, contracts, contracts_remaining, entry_price_cents, limit_cents, partial_pnl_usd, status, close_time")
      .eq("id", data.orderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (rErr || !row) return { ok: false, message: "order not found" };
    if (row.status !== "placed") return { ok: false, message: `status is ${row.status}` };
    const remaining = row.contracts_remaining ?? row.contracts;
    if (remaining <= 0) return { ok: false, message: "no contracts remaining" };
    const entry = row.entry_price_cents ?? row.limit_cents;

    // Claim the row so no other exit path double-sells.
    const { data: claimed } = await supabase
      .from("auto_trade_orders")
      .update({ status: "closing" })
      .eq("id", row.id)
      .eq("status", "placed")
      .select("id")
      .maybeSingle();
    if (!claimed) return { ok: false, message: "claim lost — already closing" };

    // Fetch fresh Kalshi quote for the sell price.
    let yesBid = 0, yesAsk = 0;
    try {
      const qres = await fetch(`${KALSHI_PUBLIC_BASE}/markets/${encodeURIComponent(row.ticker)}`, { headers: { Accept: "application/json" } });
      const qj: any = await qres.json();
      yesBid = Math.round(Number(qj?.market?.yes_bid ?? 0));
      yesAsk = Math.round(Number(qj?.market?.yes_ask ?? 0));
    } catch { /* fallthrough */ }
    if (yesBid <= 0 || yesAsk <= 0) {
      await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", row.id);
      return { ok: false, message: "no live quote" };
    }
    const sellCents = row.side === "YES" ? yesBid : (100 - yesAsk);
    const bounded = Math.max(1, Math.min(99, sellCents));

    // Paper: simulated fill.
    if (row.mode === "paper") {
      const pnl = ((bounded - entry) / 100) * remaining + Number(row.partial_pnl_usd ?? 0);
      await supabase.from("auto_trade_orders").update({
        status: pnl > 0 ? "settled_win" : "settled_loss",
        settle_price: bounded / 100,
        pnl_usd: pnl,
        partial_pnl_usd: pnl,
        contracts_remaining: 0,
        settled_at: new Date().toISOString(),
      }).eq("id", row.id);
      return { ok: true, message: `paper sold ${remaining}@${bounded}¢ · pnl $${pnl.toFixed(2)}`, pnlUsd: pnl };
    }

    if (!liveEnabled) {
      await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", row.id);
      return { ok: false, message: "KALSHI_LIVE_ENABLED not true" };
    }

    // Live: IOC market sell.
    try {
      const { signKalshi } = await import("./cryptoTrades.functions");
      const path = "/portfolio/events/orders";
      const headers = await signKalshi("POST", path, userId);
      const priceDollars = (row.side === "YES" ? bounded : 100 - bounded) / 100;
      const body = {
        ticker: row.ticker,
        action: "sell",
        side: row.side === "YES" ? "ask" : "bid",
        type: "limit",
        count: String(remaining),
        price: priceDollars.toFixed(4),
        time_in_force: "immediate_or_cancel",
        self_trade_prevention_type: "taker_at_cross",
        client_order_id: `${data.reason}-${row.id}-${Date.now()}`.slice(0, 64),
      };
      const res = await fetch(`${KALSHI_PUBLIC_BASE}${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", row.id);
        return { ok: false, message: `kalshi ${res.status}: ${j?.error?.message ?? "err"}` };
      }
      const fillCount = Number(j?.order?.fill_count ?? j?.fill_count ?? 0);
      const avgFillDollars = Number(j?.order?.average_fill_price ?? j?.average_fill_price ?? 0);
      if (!Number.isFinite(fillCount) || fillCount <= 0) {
        await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", row.id);
        return { ok: false, message: `0-fill IOC @ ${bounded}¢` };
      }
      const filledCents = avgFillDollars > 0
        ? Math.round(avgFillDollars * (row.side === "YES" ? 100 : -100) + (row.side === "YES" ? 0 : 100))
        : bounded;
      const tierPnl = ((filledCents - entry) / 100) * fillCount;
      const newPartial = Number(row.partial_pnl_usd ?? 0) + tierPnl;
      const newRemaining = Math.max(0, remaining - fillCount);
      if (newRemaining === 0) {
        await supabase.from("auto_trade_orders").update({
          status: newPartial > 0 ? "settled_win" : "settled_loss",
          settle_price: filledCents / 100,
          pnl_usd: newPartial,
          partial_pnl_usd: newPartial,
          contracts_remaining: 0,
          settled_at: new Date().toISOString(),
        }).eq("id", row.id);
        return { ok: true, message: `sold ${fillCount}@${filledCents}¢ · pnl $${newPartial.toFixed(2)}`, pnlUsd: newPartial };
      }
      await supabase.from("auto_trade_orders").update({
        status: "placed",
        partial_pnl_usd: newPartial,
        contracts_remaining: newRemaining,
      }).eq("id", row.id);
      return { ok: true, message: `partial sold ${fillCount}/${remaining}@${filledCents}¢ · rem ${newRemaining}`, pnlUsd: newPartial };
    } catch (e: any) {
      await supabase.from("auto_trade_orders").update({ status: "placed" }).eq("id", row.id);
      return { ok: false, message: `err ${e?.message ?? "x"}` };
    }
}




// ── #7 Counterfactual settle sweep ────────────────────────────────────────
// For every skipped signal whose close_time has passed, look up the real BTC
// close price and record whether the trade WOULD have won (and its would-be
// PnL at a nominal $10 stake). This lets us tell whether the gates are too
// tight (many "would_have_won" = losing edge) or well-calibrated.
export const settleAutoTradeSkipLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ settled: number }> => {
    const { supabase, userId } = context;
    const { data: due } = await (supabase as any)
      .from("auto_trade_skip_log")
      .select("id, ticker, side, strike, ask_price, close_time")
      .eq("user_id", userId)
      .is("settled_at", null)
      .lt("close_time", new Date().toISOString())
      .limit(100);
    const pending = (due ?? []) as Array<{ id: string; ticker: string; side: "YES" | "NO"; strike: number | null; ask_price: number | null; close_time: string }>;
    if (!pending.length) return { settled: 0 };

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

    const NOMINAL_STAKE = 10;
    let settled = 0;
    for (const o of pending) {
      const px = priceByTicker.get(o.ticker);
      if (px === undefined || o.strike == null || o.ask_price == null) continue;
      const won = o.side === "YES" ? px >= Number(o.strike) : px < Number(o.strike);
      const contracts = Math.max(1, Math.floor(NOMINAL_STAKE / Math.max(0.01, Number(o.ask_price))));
      const wouldHavePnl = won
        ? (1 - Number(o.ask_price)) * contracts
        : -Number(o.ask_price) * contracts;
      const { error } = await (supabase as any)
        .from("auto_trade_skip_log")
        .update({
          would_have_won: won,
          would_have_pnl: wouldHavePnl,
          settle_price: px,
          settled_at: new Date().toISOString(),
        })
        .eq("id", o.id);
      if (!error) settled++;
    }
    return { settled };
  });

export interface SkipReport {
  totalSettled: number;
  wouldHaveWon: number;
  wouldHaveLost: number;
  wouldHavePnlUsd: number;
  byReason: Array<{ reason: string; count: number; winRate: number; pnl: number }>;
}

export const getSkipReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SkipReport> => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await (supabase as any)
      .from("auto_trade_skip_log")
      .select("skip_reason, would_have_won, would_have_pnl")
      .eq("user_id", userId)
      .gte("created_at", since)
      .not("settled_at", "is", null);
    const all = (rows ?? []) as Array<{ skip_reason: string; would_have_won: boolean | null; would_have_pnl: number | null }>;
    const totalSettled = all.length;
    const wins = all.filter(r => r.would_have_won === true).length;
    const losses = all.filter(r => r.would_have_won === false).length;
    const pnl = all.reduce((s, r) => s + (Number(r.would_have_pnl) || 0), 0);

    const bucket = new Map<string, { count: number; wins: number; pnl: number }>();
    for (const r of all) {
      // Strip variable numbers so "EV 1.5¢..." and "EV 0.9¢..." bucket together
      const key = r.skip_reason.split(/[\s(:]/)[0] || "other";
      const b = bucket.get(key) ?? { count: 0, wins: 0, pnl: 0 };
      b.count++;
      if (r.would_have_won) b.wins++;
      b.pnl += Number(r.would_have_pnl) || 0;
      bucket.set(key, b);
    }
    const byReason = [...bucket.entries()]
      .map(([reason, b]) => ({ reason, count: b.count, winRate: b.count > 0 ? b.wins / b.count : 0, pnl: b.pnl }))
      .sort((a, b) => b.count - a.count);

    return { totalSettled, wouldHaveWon: wins, wouldHaveLost: losses, wouldHavePnlUsd: pnl, byReason };
  });
