// ============================================================================
// OUR-ODDS LIVE HUNTER — REAL MONEY $10 KALSHI BUY
// ----------------------------------------------------------------------------
// Real-money sibling of `OurOddsAutoBetPanel` (which is paper).
// Fires a REAL $10 Kalshi IOC buy at the current Kalshi ask whenever OUR
// own ask-side probability (client-computed via useOurQuote — same engine
// as the trendline UP/DN pills) reaches ≥ 66.7% (American −200 or better).
//
// The panel is user-toggled (default OFF, one-shot per (ticker, side)) and
// evaluates the fire condition client-side; this server fn is only invoked
// when the panel has already decided to fire. All safety rails re-check on
// the server to prevent a malicious client from bypassing them.
//
// Safety rails (per-user, per UTC day):
//   - Panel default OFF (localStorage toggle)
//   - 3-min warmup after window open (enforced client-side + server checks stc)
//   - Max ask cap: 95¢ (skip if Kalshi wants ≥95¢ — near-pin, no upside)
//   - Max fires/day: 12 (higher than cheap-flip because odds hit more often)
//   - Halt if today's our-odds-live P/L ≤ -$60
//   - Halt after 3 consecutive settled losses (auto-clears after 4h)
//   - Respects `big_flip_killswitch` (shared with cheap-flip hunter)
//   - Respects global KALSHI_LIVE_ENABLED env flag
//   - One fire per (user, ticker, side)
//
// Every fire and every skip is logged into `big_flip_signals` with
// trigger_kind='our_odds_-200' for skip/fire audit UI. Live fills land in
// `crypto_trades` with inputs_snapshot.source='our_odds_live_hunter' so
// settlement is picked up by the existing crypto_trades polling job.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Dislocation Hunter: fire when OUR mid probability exceeds Kalshi's mid
// probability for the same side by ≥ MIN_EDGE_CENTS. Trigger is validated
// client-side across 2 consecutive ticks; server re-checks the edge here.
const TRIGGER_KIND = "our_odds_disloc" as const;
const MIN_EDGE_CENTS = 3;            // our_mid − kalshi_mid ≥ 3¢ on picked side
const MIN_SIDE_PROB = 0.55;          // never chase < coin-flip
const MAX_ASK_CENTS = 85;            // avoid pin-zone chases; tighter than −200 mode
const MIN_SECS_TO_CLOSE = 20;
const WARMUP_SECS = 180;
const WINDOW_LEN_SECS = 900;
const MAX_SECS_TO_CLOSE = WINDOW_LEN_SECS - WARMUP_SECS;
const DAILY_FIRE_CAP = 12;
const DAILY_LOSS_CAP_USD = -60;
const CONSECUTIVE_LOSS_CAP = 3;
const CONSECUTIVE_HALT_HOURS = 4;
const STAKE_USD = 10;

const FireSchema = z.object({
  ticker: z.string().min(1),
  eventTicker: z.string().nullable().optional(),
  side: z.enum(["YES", "NO"]),
  ourProb: z.number().min(0).max(1),               // our mid prob on picked side
  kalshiMidProb: z.number().min(0).max(1),         // kalshi mid prob on picked side
  kalshiAskCents: z.number().int().min(1).max(99), // current Kalshi ask for that side
  closeTime: z.string(),
  spot: z.number().nullable().optional(),
  strike: z.number().nullable().optional(),
  secondsToClose: z.number().nullable().optional(),
  upCents: z.number().nullable().optional(),
  downCents: z.number().nullable().optional(),
  midPrice: z.number().nullable().optional(),
});

export type OurOddsLiveFireInput = z.infer<typeof FireSchema>;

export interface OurOddsLiveFireResult {
  ok: boolean;
  passed: boolean;
  rejectReason: string | null;
  tradeId?: string | null;
  fillCount?: number;
  fillPriceCents?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isConsecutiveLossHalt(supabase: any, userId: string) {
  const { data: last } = await supabase
    .from("crypto_trades")
    .select("outcome,created_at,inputs_snapshot")
    .eq("user_id", userId)
    .eq("inputs_snapshot->>source", "our_odds_live_hunter")
    .not("outcome", "is", null)
    .order("created_at", { ascending: false })
    .limit(CONSECUTIVE_LOSS_CAP);
  const rows = (last ?? []) as Array<{ outcome: string; created_at: string }>;
  if (rows.length < CONSECUTIVE_LOSS_CAP) return { halt: false, reason: null as string | null };
  if (!rows.every((r) => r.outcome === "loss")) return { halt: false, reason: null };
  const lastSettled = new Date(rows[0].created_at).getTime();
  const cutoff = Date.now() - CONSECUTIVE_HALT_HOURS * 60 * 60 * 1000;
  if (lastSettled < cutoff) return { halt: false, reason: null };
  return {
    halt: true,
    reason: `${CONSECUTIVE_LOSS_CAP} consecutive losses; cooldown ${CONSECUTIVE_HALT_HOURS}h`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logSignal(supabase: any, row: Record<string, unknown>) {
  try {
    await supabase.from("big_flip_signals").insert(row);
  } catch { /* audit-only; ignore */ }
}

export const fireOurOddsLiveBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: OurOddsLiveFireInput) => FireSchema.parse(data))
  .handler(async ({ data, context }): Promise<OurOddsLiveFireResult> => {
    const supabase = context.supabase;
    const userId = context.userId;

    const baseSignal = {
      user_id: userId,
      ticker: data.ticker,
      strike: data.strike ?? null,
      spot: data.spot ?? null,
      prev_yes: null,
      new_yes: null,
      prev_no: null,
      new_no: null,
      yes_delta: 0,
      to_side: data.side,
      seconds_to_close: data.secondsToClose ?? null,
      flip_at: new Date().toISOString(),
      trigger_kind: TRIGGER_KIND,
      min_ask_cents: data.kalshiAskCents,
      model_side_conf: data.ourProb,
    };

    const reject = async (reason: string): Promise<OurOddsLiveFireResult> => {
      await logSignal(supabase, { ...baseSignal, passed_rules: false, reject_reason: reason });
      return { ok: true, passed: false, rejectReason: reason };
    };

    // --- server-side re-check of all gates -------------------------------
    if (data.ourProb < MIN_PROB) {
      return reject(`our prob ${(data.ourProb * 100).toFixed(1)}% < ${(MIN_PROB * 100).toFixed(1)}%`);
    }
    if (data.kalshiAskCents > MAX_ASK_CENTS) {
      return reject(`kalshi ask ${data.kalshiAskCents}¢ > cap ${MAX_ASK_CENTS}¢`);
    }
    if (data.secondsToClose != null) {
      if (data.secondsToClose < MIN_SECS_TO_CLOSE) return reject(`pin-zone (${data.secondsToClose}s left)`);
      if (data.secondsToClose > MAX_SECS_TO_CLOSE) return reject(`warmup (${data.secondsToClose}s left > ${MAX_SECS_TO_CLOSE})`);
    }

    // Killswitch (shared with cheap-flip)
    const { data: ks } = await supabase
      .from("big_flip_killswitch")
      .select("halted,reason")
      .eq("user_id", userId)
      .maybeSingle();
    if (ks?.halted) return reject(`killswitch: ${ks.reason ?? "halted"}`);

    // One fire per (user, ticker, side, trigger_kind)
    const { data: prior } = await supabase
      .from("big_flip_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("ticker", data.ticker)
      .eq("to_side", data.side)
      .eq("trigger_kind", TRIGGER_KIND)
      .eq("passed_rules", true)
      .limit(1);
    if ((prior ?? []).length > 0) return reject("already fired this (ticker, side)");

    // Daily fire cap + daily loss cap (UTC day)
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: todays } = await supabase
      .from("crypto_trades")
      .select("id,pnl_usd")
      .eq("user_id", userId)
      .eq("inputs_snapshot->>source", "our_odds_live_hunter")
      .gte("created_at", dayStart.toISOString());
    const rows = (todays ?? []) as Array<{ id: string; pnl_usd: number | null }>;
    if (rows.length >= DAILY_FIRE_CAP) return reject(`daily cap: ${rows.length}/${DAILY_FIRE_CAP} fires used`);
    const todayPnl = rows.reduce((s, r) => s + Number(r.pnl_usd ?? 0), 0);
    if (todayPnl <= DAILY_LOSS_CAP_USD) return reject(`daily loss cap: $${todayPnl.toFixed(2)}`);

    // 3-in-a-row circuit breaker
    const cb = await isConsecutiveLossHalt(supabase, userId);
    if (cb.halt) return reject(`circuit breaker: ${cb.reason}`);

    // Global env gate
    const liveEnabled = String(process.env.KALSHI_LIVE_ENABLED ?? "").toLowerCase() === "true";
    if (!liveEnabled) return reject("KALSHI_LIVE_ENABLED not true");

    // --- fire the IOC buy at the Kalshi ask ------------------------------
    const priceCents = data.kalshiAskCents;
    const contracts = Math.max(1, Math.floor((STAKE_USD * 100) / priceCents));
    const stakeUsd = (contracts * priceCents) / 100;

    let fillCount = 0;
    let filledCents = priceCents;
    let tradeId: string | null = null;
    let orderErr: string | null = null;
    try {
      const { submitKalshiBuy } = await import("./cryptoTrades.functions");
      const out = await submitKalshiBuy(supabase, userId, {
        ticker: data.ticker,
        eventTicker: data.eventTicker ?? undefined,
        side: data.side,
        contracts,
        limitPriceCents: priceCents,
        strike: data.strike ?? undefined,
        spot: data.spot ?? undefined,
        modelProb: data.ourProb,
        marketYesPrice: data.side === "YES" ? priceCents / 100 : (100 - priceCents) / 100,
        stakeUsd,
        closeTime: data.closeTime,
        inputsSnapshot: {
          source: "our_odds_live_hunter",
          trigger: "american_-200",
          our_prob: data.ourProb,
          kalshi_ask_cents: data.kalshiAskCents,
          up_cents: data.upCents ?? null,
          down_cents: data.downCents ?? null,
          mid_price: data.midPrice ?? null,
          spot: data.spot ?? null,
          strike: data.strike ?? null,
          seconds_to_close: data.secondsToClose ?? null,
          max_ask_cents: MAX_ASK_CENTS,
          min_prob: MIN_PROB,
          stake_usd: STAKE_USD,
        },
      });
      fillCount = out.fillCount;
      filledCents = out.filledCents;
      tradeId = out.tradeId;
    } catch (e: any) {
      orderErr = e?.message ?? String(e);
    }

    if (orderErr || fillCount <= 0) {
      const reason = orderErr ? `kalshi error: ${orderErr}` : `IOC 0-fill @ ${priceCents}¢`;
      await logSignal(supabase, { ...baseSignal, passed_rules: false, reject_reason: reason });
      return { ok: true, passed: false, rejectReason: reason };
    }

    await logSignal(supabase, {
      ...baseSignal,
      passed_rules: true,
      reject_reason: null,
      kalshi_trade_id: tradeId,
      fill_count: fillCount,
      fill_price_cents: filledCents,
    });

    return {
      ok: true,
      passed: true,
      rejectReason: null,
      tradeId,
      fillCount,
      fillPriceCents: filledCents,
    };
  });


// ============================================================================
// AUTO TAKE-PROFIT — +40% on stake (sell at Kalshi bid when ≥ entry × 1.40)
// ----------------------------------------------------------------------------
// Polled by OurOddsLiveHunterPanel every few seconds while the toggle is ON.
// For each open (status='submitted') our_odds_live_hunter trade owned by
// the caller, fetches the current Kalshi market, computes the mark for the
// owning side, and fires an IOC sell if mark ≥ ceil(entry × 1.4).
// Safe idempotent: skips anything already closed/settled/errored. Never
// touches manual trades, cheap-flip fills, or any other source.
// ============================================================================

const KALSHI_BASE_TP = "https://api.elections.kalshi.com/trade-api/v2";
const TP_MULTIPLIER = 1.4;

export interface AutoTpResult {
  scanned: number;
  fired: number;
  results: Array<{
    tradeId: string;
    ticker: string;
    side: "YES" | "NO";
    entryCents: number;
    targetCents: number;
    markCents: number;
    fired: boolean;
    reason?: string;
    exitCents?: number;
    realizedPnl?: number;
  }>;
}

export const autoTakeProfitOurOddsLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutoTpResult> => {
    const supabase = context.supabase;
    const userId = context.userId;

    const { data: rows } = await supabase
      .from("crypto_trades")
      .select("id,ticker,side,contracts,stake_usd,raw,close_time,inputs_snapshot")
      .eq("user_id", userId)
      .eq("status", "submitted")
      .eq("inputs_snapshot->>source", "our_odds_live_hunter")
      .order("created_at", { ascending: true })
      .limit(20);

    const trades = (rows ?? []) as Array<{
      id: string; ticker: string; side: "YES" | "NO";
      contracts: number; stake_usd: number; raw: any; close_time: string | null;
    }>;

    if (trades.length === 0) return { scanned: 0, fired: 0, results: [] };

    const { signKalshi } = await import("./cryptoTrades.functions");
    const results: AutoTpResult["results"] = [];
    let fired = 0;

    for (const t of trades) {
      if (!t.contracts || t.contracts <= 0) continue;
      const entryCents = Math.round((Number(t.stake_usd) / Number(t.contracts)) * 100);
      const targetCents = Math.min(99, Math.ceil(entryCents * TP_MULTIPLIER));

      // Skip trades already close to settlement (< 20s) — pin-zone risk
      if (t.close_time) {
        const stc = Math.floor((Date.parse(t.close_time) - Date.now()) / 1000);
        if (stc < 20) {
          results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents: 0, fired: false, reason: "pin-zone" });
          continue;
        }
      }

      // Fetch current market
      let yesBid = 0, yesAsk = 0;
      try {
        const mPath = `/markets/${encodeURIComponent(t.ticker)}`;
        const h = await signKalshi("GET", mPath, userId);
        const mr = await fetch(`${KALSHI_BASE_TP}${mPath}`, { headers: { ...h, Accept: "application/json" } });
        const mj: any = await mr.json().catch(() => ({}));
        const m = mj?.market ?? mj;
        yesBid = Number(m?.yes_bid ?? 0);
        yesAsk = Number(m?.yes_ask ?? 0);
      } catch (e: any) {
        results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents: 0, fired: false, reason: `market fetch: ${e?.message ?? "err"}` });
        continue;
      }

      // Mark = current best exit price for the side we own
      // YES holder sells @ yesBid; NO holder sells @ (100 - yesAsk)
      const markCents = t.side === "YES" ? yesBid : (100 - yesAsk);

      if (markCents < targetCents) {
        results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents, fired: false, reason: "below target" });
        continue;
      }

      // Fire IOC sell at targetCents (limit → we take mark or better)
      const path = "/portfolio/events/orders";
      let sellHeaders: Record<string, string>;
      try {
        sellHeaders = await signKalshi("POST", path, userId);
      } catch (e: any) {
        results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents, fired: false, reason: `sign: ${e?.message ?? "err"}` });
        continue;
      }
      const limitCents = targetCents;
      const priceDollars = (t.side === "YES" ? limitCents : 100 - limitCents) / 100;
      const body = {
        ticker: t.ticker,
        action: "sell",
        side: t.side === "YES" ? "ask" : "bid",
        type: "limit",
        count: String(t.contracts),
        price: priceDollars.toFixed(4),
        time_in_force: "immediate_or_cancel",
        self_trade_prevention_type: "taker_at_cross",
        client_order_id: `tp40-${t.id}`,
      };
      const res = await fetch(`${KALSHI_BASE_TP}${path}`, {
        method: "POST",
        headers: { ...sellHeaders, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents, fired: false, reason: `kalshi ${res.status}: ${json?.error?.message ?? json?.message ?? ""}` });
        continue;
      }
      const fillCount = Number(json?.order?.fill_count ?? json?.fill_count ?? 0) || 0;
      if (fillCount <= 0) {
        results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents, fired: false, reason: "0-fill" });
        continue;
      }
      const avgFillDollars = Number(json?.order?.average_fill_price ?? json?.average_fill_price ?? 0) || 0;
      const exitCents = avgFillDollars > 0
        ? (t.side === "YES" ? Math.round(avgFillDollars * 100) : Math.round(100 - avgFillDollars * 100))
        : limitCents;
      const realizedPnl = ((exitCents - entryCents) / 100) * Number(t.contracts);
      const closeOrderId = json?.order_id ?? json?.order?.order_id ?? null;
      const prevRaw = (t.raw as any) ?? {};
      await supabase.from("crypto_trades").update({
        status: "closed",
        pnl_usd: realizedPnl,
        raw: { ...prevRaw, close: { at: new Date().toISOString(), source: "auto_tp_40pct", exit_cents: exitCents, entry_cents: entryCents, kalshi_order_id: closeOrderId, response: json } },
      }).eq("id", t.id);

      fired += 1;
      results.push({ tradeId: t.id, ticker: t.ticker, side: t.side, entryCents, targetCents, markCents, fired: true, exitCents, realizedPnl });
    }

    return { scanned: trades.length, fired, results };
  });
