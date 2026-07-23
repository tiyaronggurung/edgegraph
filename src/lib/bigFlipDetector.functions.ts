import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// CHEAP-FLIP HUNTER — LIVE MONEY (always on, no toggle)
// ----------------------------------------------------------------------------
// Fires a REAL $10 Kalshi IOC buy when a 15-min BTC market has a side quoted
// at <= 15c inside the "sweet spot" (T-9m to T-3m) AND the model actually
// likes that cheap side (side confidence >= 0.70).
//
// Runs 24/7 via /api/public/hooks/big-flip-tick cron for every user with
// Kalshi creds configured. No enable button, no user opt-in — it is always on.
//
// Every fire and every skip is logged into `big_flip_signals` with
// trigger_kind='cheap_flip_15c' for skip/fire audit UI.
// Live fills land in `crypto_trades` with inputs_snapshot.source='cheap_flip_hunter'
// so we can query settlement status (auto-settled by the crypto_trades polling job).
//
// Safety rails (per-user, per UTC day):
//   - max 6 fires/day
//   - halt if today's cheap_flip P/L <= -$60
//   - halt after 3 consecutive settled losses (auto-clears after 4h)
//   - respects existing big_flip_killswitch
//   - respects global KALSHI_LIVE_ENABLED env flag (if 'false', logs a skip)
// ============================================================================

const TRIGGER_KIND = "cheap_flip_15c" as const;
const MAX_ASK_CENTS = 15;
const MIN_MODEL_SIDE_CONF = 0.70;
const ARM_MIN_SECONDS = 3 * 60;   // T-3m
const ARM_MAX_SECONDS = 9 * 60;   // T-9m
const DAILY_FIRE_CAP = 6;
const DAILY_LOSS_CAP_USD = -60;   // -$60
const CONSECUTIVE_LOSS_CAP = 3;
const CONSECUTIVE_HALT_HOURS = 4;
const STAKE_CENTS = 1000;         // $10 flat

// ---------------------------------------------------------------------------
// BRR-LEAD SHADOW GATE (shadow mode — no live effect)
// ---------------------------------------------------------------------------
// Our composite spot leads Kalshi's BRR (60s VWAP) by ~15–30s. We log every
// candidate that reaches model-agreement (Gate 3 passed) with:
//   brr_proxy    = rolling 60s VWAP of our composite spot ticks
//   lead_delta   = spot - brr_proxy  (positive => spot leading UP)
//   gate_decision = boost | confirm | veto | neutral
// Data lands in `big_flip_lead_shadow` for A/B comparison vs live outcomes.
const LEAD_BOOST_ABS_USD = 25;   // |delta| >= 25 & agrees => boost
const LEAD_VETO_ABS_USD = 15;    // |delta| >= 15 & opposes => veto
const BRR_WINDOW_SEC = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeBrrLead(supabase: any, cheapSide: "YES" | "NO", spotNow: number) {
  const sinceIso = new Date(Date.now() - BRR_WINDOW_SEC * 1000).toISOString();
  const { data } = await supabase
    .from("btc_spot_ticks")
    .select("spot,volume,observed_at")
    .gte("observed_at", sinceIso)
    .order("observed_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as Array<{ spot: number; volume: number | null }>;
  if (rows.length === 0) {
    return { brrProxy: null as number | null, sampleCount: 0, leadDelta: null as number | null, decision: "neutral" as const, reason: "no ticks in 60s window" };
  }
  let vwapNum = 0, vwapDen = 0, meanSum = 0;
  for (const r of rows) {
    const s = Number(r.spot);
    const v = Math.max(0, Number(r.volume ?? 0));
    if (v > 0) { vwapNum += s * v; vwapDen += v; }
    meanSum += s;
  }
  const brrProxy = vwapDen > 0 ? vwapNum / vwapDen : meanSum / rows.length;
  const leadDelta = spotNow - brrProxy;
  const agrees = (cheapSide === "YES" && leadDelta > 0) || (cheapSide === "NO" && leadDelta < 0);
  const abs = Math.abs(leadDelta);
  let decision: "boost" | "confirm" | "veto" | "neutral";
  let reason: string;
  if (agrees && abs >= LEAD_BOOST_ABS_USD) { decision = "boost"; reason = `agree $${abs.toFixed(2)} >= boost $${LEAD_BOOST_ABS_USD}`; }
  else if (!agrees && abs >= LEAD_VETO_ABS_USD) { decision = "veto"; reason = `oppose $${abs.toFixed(2)} >= veto $${LEAD_VETO_ABS_USD}`; }
  else if (agrees) { decision = "confirm"; reason = `agree $${abs.toFixed(2)}`; }
  else { decision = "neutral"; reason = `oppose $${abs.toFixed(2)} < veto $${LEAD_VETO_ABS_USD}`; }
  return { brrProxy, sampleCount: rows.length, leadDelta, decision, reason };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertLeadShadow(supabase: any, row: Record<string, unknown>): Promise<string | null> {
  try {
    const { data } = await supabase.from("big_flip_lead_shadow").insert(row).select("id").maybeSingle();
    return (data?.id as string) ?? null;
  } catch { return null; }
}

export interface CheapFlipSignal {
  ok: boolean;
  ticker: string | null;
  toSide: "YES" | "NO" | null;
  prevYes: number | null;   // reused = current yes ask
  newYes: number | null;    // reused = current yes ask
  yesDelta: number | null;  // reused = 0 (kept for UI back-compat)
  spot: number | null;
  strike: number | null;
  secondsToClose: number | null;
  flipAt: string | null;
  passed: boolean;
  rejectReason: string | null;
  ageSeconds: number | null;
  minAskCents: number | null;
  modelSideConf: number | null;
}

const empty: CheapFlipSignal = {
  ok: false, ticker: null, toSide: null, prevYes: null, newYes: null,
  yesDelta: null, spot: null, strike: null, secondsToClose: null,
  flipAt: null, passed: false, rejectReason: null, ageSeconds: null,
  minAskCents: null, modelSideConf: null,
};

// Legacy alias for compat with imports elsewhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BigFlipSignal = CheapFlipSignal;

async function isConsecutiveLossHalt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<{ halt: boolean; reason: string | null }> {
  const { data: last } = await supabase
    .from("crypto_trades")
    .select("outcome,created_at,inputs_snapshot")
    .eq("user_id", userId)
    .eq("inputs_snapshot->>source", "cheap_flip_hunter")
    .not("outcome", "is", null)
    .order("created_at", { ascending: false })
    .limit(CONSECUTIVE_LOSS_CAP);
  const rows = (last ?? []) as Array<{ outcome: string; created_at: string }>;
  if (rows.length < CONSECUTIVE_LOSS_CAP) return { halt: false, reason: null };
  if (!rows.every(r => r.outcome === "loss")) return { halt: false, reason: null };
  const lastSettled = new Date(rows[0].created_at).getTime();
  const cutoff = Date.now() - CONSECUTIVE_HALT_HOURS * 60 * 60 * 1000;
  if (lastSettled < cutoff) return { halt: false, reason: null };
  return {
    halt: true,
    reason: `${CONSECUTIVE_LOSS_CAP} consecutive losses; cooldown until ${new Date(lastSettled + CONSECUTIVE_HALT_HOURS * 60 * 60 * 1000).toISOString()}`,
  };
}

// Shared body. `supabase` is user-scoped (RLS) OR admin (cron path).
export async function runBigFlipForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<CheapFlipSignal> {
  // Latest tape snapshot.
  const { data: tapeRows } = await supabase
    .from("btc_odds_tape")
    .select("ticker,yes_cents,no_cents,spot,strike,seconds_to_close,snapped_at")
    .eq("user_id", userId)
    .order("snapped_at", { ascending: false })
    .limit(1);
  const tape = (tapeRows ?? [])[0] as
    | { ticker: string; yes_cents: number; no_cents: number; spot: number; strike: number; seconds_to_close: number; snapped_at: string }
    | undefined;
  if (!tape) return empty;

  const ticker = tape.ticker;
  const yesAsk = tape.yes_cents;
  const noAsk = tape.no_cents;
  const stc = tape.seconds_to_close;
  const flipAt = tape.snapped_at;
  const ageSeconds = Math.floor((Date.now() - new Date(flipAt).getTime()) / 1000);

  const base = {
    ok: true, ticker,
    toSide: null as "YES" | "NO" | null,
    prevYes: yesAsk, newYes: yesAsk, yesDelta: 0,
    spot: tape.spot, strike: tape.strike,
    secondsToClose: stc, flipAt,
    passed: false, rejectReason: null as string | null,
    ageSeconds,
    minAskCents: Math.min(yesAsk, noAsk),
    modelSideConf: null as number | null,
  };

  // --- Gate 1: time window (T-9m to T-3m) --------------------------------
  if (stc > ARM_MAX_SECONDS) return { ...base, rejectReason: `too early (${stc}s left, arm at ${ARM_MAX_SECONDS}s)` };
  if (stc < ARM_MIN_SECONDS) return { ...base, rejectReason: `too late (${stc}s left, disarm at ${ARM_MIN_SECONDS}s)` };

  // --- Gate 2: cheap ask on at least one side ----------------------------
  const yesCheap = yesAsk <= MAX_ASK_CENTS;
  const noCheap = noAsk <= MAX_ASK_CENTS;
  if (!yesCheap && !noCheap) return { ...base, rejectReason: `no cheap side (yes=${yesAsk}¢ no=${noAsk}¢)` };
  const cheapSide: "YES" | "NO" = yesCheap && (!noCheap || yesAsk <= noAsk) ? "YES" : "NO";
  const cheapAsk = cheapSide === "YES" ? yesAsk : noAsk;

  // --- Gate 3: model agreement (side + confidence >= 0.70) ---------------
  const { data: pred } = await supabase
    .from("btc_model_predictions")
    .select("side,model_prob,event_ticker,close_time")
    .eq("ticker", ticker)
    .maybeSingle();
  const modelSide = (pred?.side ?? null) as "YES" | "NO" | null;
  const modelProb = pred?.model_prob != null ? Number(pred.model_prob) : null;
  const eventTicker = (pred as any)?.event_ticker ?? null;
  const closeTimeIso = (pred as any)?.close_time
    ?? new Date(new Date(flipAt).getTime() + stc * 1000).toISOString();
  if (!modelSide || modelProb == null) {
    return { ...base, toSide: cheapSide, rejectReason: "no model prediction yet" };
  }
  if (modelSide !== cheapSide) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `model picks ${modelSide}, cheap side is ${cheapSide}` };
  }
  if (modelProb < MIN_MODEL_SIDE_CONF) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `model conf ${(modelProb * 100).toFixed(1)}% < 70%` };
  }

  // --- Gate 4: one fire per (user, ticker) -------------------------------
  const { data: prior } = await supabase
    .from("big_flip_signals")
    .select("id")
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .eq("trigger_kind", TRIGGER_KIND)
    .eq("passed_rules", true)
    .limit(1);
  if ((prior ?? []).length > 0) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: "already fired this window" };
  }

  // --- Gate 5: killswitch ------------------------------------------------
  const { data: ks } = await supabase
    .from("big_flip_killswitch")
    .select("halted,reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (ks?.halted) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `killswitch: ${ks.reason ?? "halted"}` };
  }

  // --- Gate 6: daily fire cap + daily loss cap (UTC day) -----------------
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  const { data: todays } = await supabase
    .from("crypto_trades")
    .select("id,outcome,pnl_usd")
    .eq("user_id", userId)
    .eq("inputs_snapshot->>source", "cheap_flip_hunter")
    .gte("created_at", dayStartIso);
  const todaysRows = (todays ?? []) as Array<{ id: string; outcome: string | null; pnl_usd: number | null }>;
  if (todaysRows.length >= DAILY_FIRE_CAP) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `daily cap: ${todaysRows.length}/${DAILY_FIRE_CAP} fires used` };
  }
  const todayPnl = todaysRows.reduce((s, r) => s + (Number(r.pnl_usd ?? 0)), 0);
  if (todayPnl <= DAILY_LOSS_CAP_USD) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `daily loss cap: $${todayPnl.toFixed(2)}` };
  }

  // --- Gate 7: 3-in-a-row consecutive-loss circuit breaker ---------------
  const cbr = await isConsecutiveLossHalt(supabase, userId);
  if (cbr.halt) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `circuit breaker: ${cbr.reason}` };
  }

  // --- Gate 8: global KALSHI_LIVE_ENABLED --------------------------------
  const liveEnabled = String(process.env.KALSHI_LIVE_ENABLED ?? "").toLowerCase() === "true";
  if (!liveEnabled) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: "KALSHI_LIVE_ENABLED not true" };
  }

  // --- BRR-LEAD SHADOW (log every candidate that reached model agreement) --
  const lead = await computeBrrLead(supabase, cheapSide, Number(tape.spot));
  const shadowId = await insertLeadShadow(supabase, {
    user_id: userId,
    ticker,
    cheap_side: cheapSide,
    cheap_ask_cents: cheapAsk,
    model_side: modelSide,
    model_prob: modelProb,
    spot: tape.spot,
    strike: tape.strike,
    seconds_to_close: stc,
    brr_proxy: lead.brrProxy,
    brr_sample_count: lead.sampleCount,
    lead_delta: lead.leadDelta,
    gate_decision: lead.decision,
    gate_reason: lead.reason,
    live_fired: false,
  });

  // -----------------------------------------------------------------------
  // ALL GATES PASSED — fire LIVE Kalshi IOC $10 buy.
  // -----------------------------------------------------------------------
  const contracts = Math.max(1, Math.floor(STAKE_CENTS / cheapAsk));
  const stakeUsd = (contracts * cheapAsk) / 100;

  let fillCount = 0;
  let filledCents = cheapAsk;
  let orderErr: string | null = null;
  let tradeId: string | null = null;
  try {
    const { submitKalshiBuy } = await import("./cryptoTrades.functions");
    const out = await submitKalshiBuy(supabase, userId, {
      ticker,
      eventTicker: eventTicker ?? undefined,
      side: cheapSide,
      contracts,
      limitPriceCents: cheapAsk,
      strike: tape.strike,
      spot: tape.spot,
      modelProb,
      marketYesPrice: yesAsk / 100,
      stakeUsd,
      closeTime: closeTimeIso,
      inputsSnapshot: {
        source: "cheap_flip_hunter",
        yes_ask: yesAsk,
        no_ask: noAsk,
        model_side: modelSide,
        model_prob: modelProb,
        seconds_to_close: stc,
        spot: tape.spot,
        strike: tape.strike,
        arm_window: [ARM_MIN_SECONDS, ARM_MAX_SECONDS],
        max_ask_cents: MAX_ASK_CENTS,
        min_model_conf: MIN_MODEL_SIDE_CONF,
      },
    });
    fillCount = out.fillCount;
    filledCents = out.filledCents;
    tradeId = out.tradeId;
  } catch (e: any) {
    orderErr = e?.message ?? String(e);
  }

  // If the IOC returned 0 fills OR errored, log a skip row and bail.
  if (orderErr || fillCount <= 0) {
    await supabase.from("big_flip_signals").insert({
      user_id: userId, ticker, strike: tape.strike, spot: tape.spot,
      prev_yes: yesAsk, new_yes: yesAsk, prev_no: noAsk, new_no: noAsk,
      yes_delta: 0, to_side: cheapSide, seconds_to_close: stc,
      passed_rules: false,
      reject_reason: orderErr ? `kalshi error: ${orderErr}` : `IOC 0-fill @ ${cheapAsk}¢`,
      flip_at: flipAt, trigger_kind: TRIGGER_KIND,
      min_ask_cents: cheapAsk, model_side_conf: modelProb,
    });
    return {
      ...base, toSide: cheapSide, modelSideConf: modelProb,
      rejectReason: orderErr ? `kalshi error: ${orderErr}` : `IOC 0-fill @ ${cheapAsk}¢`,
    };
  }

  // Log the passing signal — used for skip/fire audit UI + one-per-window gate.
  await supabase.from("big_flip_signals").insert({
    user_id: userId, ticker, strike: tape.strike, spot: tape.spot,
    prev_yes: yesAsk, new_yes: yesAsk, prev_no: noAsk, new_no: noAsk,
    yes_delta: 0, to_side: cheapSide, seconds_to_close: stc,
    passed_rules: true, reject_reason: null,
    flip_at: flipAt, trigger_kind: TRIGGER_KIND,
    min_ask_cents: cheapAsk, model_side_conf: modelProb,
    paper_fill_id: null,
    kalshi_trade_id: tradeId,
    fill_count: fillCount,
    fill_price_cents: filledCents,
  });

  return {
    ok: true, ticker, toSide: cheapSide,
    prevYes: yesAsk, newYes: yesAsk, yesDelta: 0,
    spot: tape.spot, strike: tape.strike, secondsToClose: stc,
    flipAt, passed: true, rejectReason: null, ageSeconds,
    minAskCents: filledCents, modelSideConf: modelProb,
  };
}

export const detectBigFlip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CheapFlipSignal> => {
    return runBigFlipForUser(context.supabase, context.userId);
  });
