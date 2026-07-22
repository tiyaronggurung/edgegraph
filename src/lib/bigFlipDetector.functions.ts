import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// CHEAP-FLIP HUNTER  (formerly "Big Flip" 25c-jump detector, retired 2026-07-22)
// ----------------------------------------------------------------------------
// Fires PAPER $10 stakes when a Kalshi 15-min BTC market has a side quoted at
// <= 15c inside the "sweet spot" (T-9m to T-3m) AND the model actually likes
// that cheap side (side confidence >= 0.70).
//
// Every fire and every skip is logged into `big_flip_signals` with
// trigger_kind='cheap_flip_15c' so we can audit fill quality and skip reasons.
//
// Safety rails (per-user, per UTC day):
//   - max 6 fires/day
//   - halt if today's cheap_flip P/L <= -$60
//   - halt after 3 consecutive settled losses (auto-clears after 4h)
//   - respects existing big_flip_killswitch
// ============================================================================

const TRIGGER_KIND = "cheap_flip_15c" as const;
const MAX_ASK_CENTS = 15;
const MIN_MODEL_SIDE_CONF = 0.70;
const ARM_MIN_SECONDS = 3 * 60;   // T-3m
const ARM_MAX_SECONDS = 9 * 60;   // T-9m
const DAILY_FIRE_CAP = 6;
const DAILY_LOSS_CAP_CENTS = -6000; // -$60
const CONSECUTIVE_LOSS_CAP = 3;
const CONSECUTIVE_HALT_HOURS = 4;
const STAKE_CENTS = 1000; // $10 flat

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
  // cheap-flip specifics
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
    .from("paper_fills")
    .select("status,settled_at")
    .eq("user_id", userId)
    .eq("button", "cheap_flip")
    .in("status", ["won", "lost"])
    .order("settled_at", { ascending: false })
    .limit(CONSECUTIVE_LOSS_CAP);
  const rows = (last ?? []) as Array<{ status: string; settled_at: string }>;
  if (rows.length < CONSECUTIVE_LOSS_CAP) return { halt: false, reason: null };
  if (!rows.every(r => r.status === "lost")) return { halt: false, reason: null };
  const lastSettled = new Date(rows[0].settled_at).getTime();
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
  // Latest ticker + latest tape snapshot for this user.
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
    .select("side,model_prob")
    .eq("ticker", ticker)
    .maybeSingle();
  const modelSide = (pred?.side ?? null) as "YES" | "NO" | null;
  const modelProb = pred?.model_prob != null ? Number(pred.model_prob) : null;
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
    .from("paper_fills")
    .select("status,pnl_cents")
    .eq("user_id", userId)
    .eq("button", "cheap_flip")
    .gte("created_at", dayStartIso);
  const todaysRows = (todays ?? []) as Array<{ status: string; pnl_cents: number | null }>;
  if (todaysRows.length >= DAILY_FIRE_CAP) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `daily cap: ${todaysRows.length}/${DAILY_FIRE_CAP} fires used` };
  }
  const todayPnl = todaysRows.reduce((s, r) => s + (r.pnl_cents ?? 0), 0);
  if (todayPnl <= DAILY_LOSS_CAP_CENTS) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `daily loss cap: $${(todayPnl / 100).toFixed(2)}` };
  }

  // --- Gate 7: 3-in-a-row consecutive-loss circuit breaker ---------------
  const cbr = await isConsecutiveLossHalt(supabase, userId);
  if (cbr.halt) {
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: `circuit breaker: ${cbr.reason}` };
  }

  // -----------------------------------------------------------------------
  // ALL GATES PASSED — fire paper stake + log the signal.
  // -----------------------------------------------------------------------
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Debit paper balance
  const { data: balRow } = await supabaseAdmin
    .from("paper_balances")
    .select("balance_cents,starting_cents,bankrupt_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!balRow) {
    await supabaseAdmin.from("paper_balances").insert({ user_id: userId });
  }
  const currentBal = (balRow?.balance_cents as number | undefined) ?? 50000;
  if ((balRow?.bankrupt_at as string | null) || currentBal < STAKE_CENTS) {
    // Log the miss so we can see the trap fired but stake was unavailable.
    await supabase.from("big_flip_signals").insert({
      user_id: userId, ticker, strike: tape.strike, spot: tape.spot,
      prev_yes: yesAsk, new_yes: yesAsk, prev_no: noAsk, new_no: noAsk,
      yes_delta: 0, to_side: cheapSide, seconds_to_close: stc,
      passed_rules: false, reject_reason: "paper bankrupt or insufficient balance",
      flip_at: flipAt, trigger_kind: TRIGGER_KIND,
      min_ask_cents: cheapAsk, model_side_conf: modelProb,
    });
    return { ...base, toSide: cheapSide, modelSideConf: modelProb, rejectReason: "paper bankrupt or insufficient balance" };
  }

  const contracts = Math.max(1, Math.floor((STAKE_CENTS) / cheapAsk));
  const closeTime = new Date(new Date(flipAt).getTime() + stc * 1000).toISOString();
  const newBal = currentBal - STAKE_CENTS;

  await supabaseAdmin
    .from("paper_balances")
    .update({ balance_cents: newBal, bankrupt_at: newBal <= 0 ? new Date().toISOString() : null })
    .eq("user_id", userId);

  const { data: fill } = await supabaseAdmin
    .from("paper_fills")
    .insert({
      user_id: userId,
      ticker,
      close_time: closeTime,
      button: "cheap_flip",
      side: cheapSide,
      contracts,
      fill_price_cents: cheapAsk,
      stake_cents: STAKE_CENTS,
      entry_snapshot: {
        source: "cheap_flip_hunter",
        yes_ask: yesAsk, no_ask: noAsk,
        model_side: modelSide, model_prob: modelProb,
        seconds_to_close: stc,
        spot: tape.spot, strike: tape.strike,
      },
      status: "open",
    })
    .select("id")
    .single();

  // Log the signal (passed_rules=true) — used for skip/fire audit UI.
  await supabase.from("big_flip_signals").insert({
    user_id: userId, ticker, strike: tape.strike, spot: tape.spot,
    prev_yes: yesAsk, new_yes: yesAsk, prev_no: noAsk, new_no: noAsk,
    yes_delta: 0, to_side: cheapSide, seconds_to_close: stc,
    passed_rules: true, reject_reason: null,
    flip_at: flipAt, trigger_kind: TRIGGER_KIND,
    min_ask_cents: cheapAsk, model_side_conf: modelProb,
    paper_fill_id: fill?.id ?? null,
  });

  return {
    ok: true, ticker, toSide: cheapSide,
    prevYes: yesAsk, newYes: yesAsk, yesDelta: 0,
    spot: tape.spot, strike: tape.strike, secondsToClose: stc,
    flipAt, passed: true, rejectReason: null, ageSeconds,
    minAskCents: cheapAsk, modelSideConf: modelProb,
  };
}

export const detectBigFlip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CheapFlipSignal> => {
    return runBigFlipForUser(context.supabase, context.userId);
  });
