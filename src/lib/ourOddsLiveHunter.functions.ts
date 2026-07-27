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

const TRIGGER_KIND = "our_odds_-200" as const;
const MIN_PROB = 2 / 3;              // American -200
const MAX_ASK_CENTS = 95;            // skip if Kalshi already pinned to 95+
const MIN_SECS_TO_CLOSE = 15;        // pin-zone slippage guard
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
  ourProb: z.number().min(0).max(1),         // our ask-side probability
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
