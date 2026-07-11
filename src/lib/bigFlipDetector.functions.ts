import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Detects "big flips": one-tick YES delta >= 25c with confirming conditions.
// Writes qualifying flips to big_flip_signals AND places a live $10 Kalshi
// buy on the first insert. Runs from:
//   - the /crypto page via detectBigFlip (client polling, per-user)
//   - a server cron via /api/public/hooks/big-flip-tick (24/7, all users)

const YES_DELTA_MIN = 25;
const MIN_SECONDS_TO_CLOSE = 20;
// Short cooldown so a fade-then-flip-back sequence can bet on each leg.
// Prevents duplicate fires on the same tick but allows genuine re-flips.
const SAME_TICKER_COOLDOWN_SEC = 20;
const LIVE_STAKE_USD = 10;
// Killswitch: if there are >= LOSS_HALT_THRESHOLD losing big-flip trades
// within the last LOSS_HALT_WINDOW_COUNT distinct 15-min windows that had
// a big-flip trade, halt auto-trading until the user re-enables it.
const LOSS_HALT_THRESHOLD = 4;
const LOSS_HALT_WINDOW_COUNT = 10;

export interface BigFlipSignal {
  ok: boolean;
  ticker: string | null;
  toSide: "YES" | "NO" | null;
  prevYes: number | null;
  newYes: number | null;
  yesDelta: number | null;
  spot: number | null;
  strike: number | null;
  secondsToClose: number | null;
  flipAt: string | null;
  passed: boolean;
  rejectReason: string | null;
  ageSeconds: number | null;
}

const empty: BigFlipSignal = {
  ok: false, ticker: null, toSide: null, prevYes: null, newYes: null,
  yesDelta: null, spot: null, strike: null, secondsToClose: null,
  flipAt: null, passed: false, rejectReason: null, ageSeconds: null,
};

// Shared detection body. `supabase` may be a user-scoped client (RLS) or the
// admin client (cron). Returns the signal; ALSO inserts into big_flip_signals
// and fires a live Kalshi buy on first insert when rules pass.
export async function runBigFlipForUser(
  supabase: any,
  userId: string,
): Promise<BigFlipSignal> {
  const { data: latestRow } = await supabase
    .from("btc_odds_tape")
    .select("ticker")
    .eq("user_id", userId)
    .order("snapped_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestRow?.ticker) return empty;
  const ticker = latestRow.ticker as string;

  const { data: rows } = await supabase
    .from("btc_odds_tape")
    .select("yes_cents,no_cents,spot,strike,seconds_to_close,snapped_at")
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .order("snapped_at", { ascending: false })
    .limit(40);
  const samples = (rows ?? []).slice().reverse();
  if (samples.length < 2) return { ...empty, ok: true, ticker };

  // Most recent one-tick move >= 25c.
  let big: { i: number; delta: number } | null = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].yes_cents as number;
    const cur = samples[i].yes_cents as number;
    const d = cur - prev;
    if (Math.abs(d) >= YES_DELTA_MIN) big = { i, delta: d };
  }
  if (!big) {
    const last = samples[samples.length - 1];
    return {
      ok: true, ticker, toSide: null,
      prevYes: null, newYes: last.yes_cents as number,
      yesDelta: null, spot: last.spot as number, strike: last.strike as number,
      secondsToClose: last.seconds_to_close as number,
      flipAt: null, passed: false, rejectReason: null, ageSeconds: null,
    };
  }

  const flipSample = samples[big.i];
  const prevSample = samples[big.i - 1];
  const toSide: "YES" | "NO" = big.delta > 0 ? "YES" : "NO";
  const spot = flipSample.spot as number;
  const strike = flipSample.strike as number;
  const stc = flipSample.seconds_to_close as number;
  const flipAt = flipSample.snapped_at as string;
  const ageSeconds = Math.floor((Date.now() - new Date(flipAt).getTime()) / 1000);

  let passed = true;
  let reject: string | null = null;
  if (toSide === "YES" && spot <= strike) { passed = false; reject = "spot not above strike for YES flip"; }
  else if (toSide === "NO" && spot >= strike) { passed = false; reject = "spot not below strike for NO flip"; }
  else if (stc < MIN_SECONDS_TO_CLOSE) { passed = false; reject = `only ${stc}s to close`; }
  else {
    // 20s cooldown across ANY prior flip on this ticker — allows re-flips
    // but not duplicate fires on the same tick.
    const cutoff = new Date(new Date(flipAt).getTime() - SAME_TICKER_COOLDOWN_SEC * 1000).toISOString();
    const { data: prior } = await supabase
      .from("big_flip_signals")
      .select("flip_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .gte("flip_at", cutoff)
      .lt("flip_at", flipAt)
      .limit(1);
    if ((prior ?? []).length > 0) { passed = false; reject = "cooldown: prior flip within 20s"; }
  }

  const { error: insErr } = await supabase.from("big_flip_signals").insert({
    user_id: userId,
    ticker,
    strike,
    spot,
    prev_yes: prevSample.yes_cents as number,
    new_yes: flipSample.yes_cents as number,
    prev_no: prevSample.no_cents as number,
    new_no: flipSample.no_cents as number,
    yes_delta: big.delta,
    to_side: toSide,
    seconds_to_close: stc,
    passed_rules: passed,
    reject_reason: reject,
    flip_at: flipAt,
  });
  const firstTime = !insErr;

  if (passed && firstTime) {
    // Killswitch check: if user has manually halted, or if the recent
    // loss rate crossed the threshold, block the order and (auto-)halt.
    const { data: ks } = await supabase
      .from("big_flip_killswitch")
      .select("halted,reason")
      .eq("user_id", userId)
      .maybeSingle();
    if (ks?.halted) {
      return {
        ok: true, ticker, toSide,
        prevYes: prevSample.yes_cents as number,
        newYes: flipSample.yes_cents as number,
        yesDelta: big.delta,
        spot, strike, secondsToClose: stc,
        flipAt, passed: false,
        rejectReason: `auto-trade halted: ${ks.reason ?? "killswitch on"}`,
        ageSeconds,
      };
    }

    // Evaluate loss count over the last N distinct 15-min windows that had
    // a big-flip trade. Look at settled trades tagged source=big_flip_detector.
    try {
      const { data: recent } = await supabase
        .from("crypto_trades")
        .select("created_at,pnl_usd,outcome,inputs_snapshot,status")
        .eq("user_id", userId)
        .not("pnl_usd", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      const bigFlipSettled = (recent ?? []).filter((r: any) =>
        r?.inputs_snapshot?.source === "big_flip_detector"
      );
      // Bucket trades into 15-min windows, walk newest-first, take the last
      // LOSS_HALT_WINDOW_COUNT distinct windows, count windows with any loss.
      const windows = new Map<number, { hasLoss: boolean }>();
      for (const r of bigFlipSettled) {
        const t = new Date(r.created_at as string).getTime();
        const bucket = Math.floor(t / (15 * 60 * 1000));
        const isLoss = (r.pnl_usd != null && Number(r.pnl_usd) < 0)
          || r.outcome === "loss";
        if (!windows.has(bucket)) windows.set(bucket, { hasLoss: isLoss });
        else if (isLoss) windows.get(bucket)!.hasLoss = true;
        if (windows.size >= LOSS_HALT_WINDOW_COUNT) break;
      }
      const losingWindows = [...windows.values()].filter((w) => w.hasLoss).length;
      if (losingWindows >= LOSS_HALT_THRESHOLD) {
        const reason = `${losingWindows} losing windows in last ${windows.size} (auto-halt)`;
        await supabase
          .from("big_flip_killswitch")
          .upsert({
            user_id: userId,
            halted: true,
            halted_at: new Date().toISOString(),
            reason,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
        return {
          ok: true, ticker, toSide,
          prevYes: prevSample.yes_cents as number,
          newYes: flipSample.yes_cents as number,
          yesDelta: big.delta,
          spot, strike, secondsToClose: stc,
          flipAt, passed: false,
          rejectReason: `auto-trade halted: ${reason}`,
          ageSeconds,
        };
      }
    } catch (e) {
      console.error("[bigFlipDetector] killswitch eval failed:", (e as Error)?.message);
    }

    try {
      const { submitKalshiBuy } = await import("./cryptoTrades.functions");
      const limitCents = toSide === "YES"
        ? (flipSample.yes_cents as number)
        : (flipSample.no_cents as number);
      if (limitCents >= 1 && limitCents <= 99) {
        const contracts = Math.max(1, Math.floor((LIVE_STAKE_USD * 100) / limitCents));
        await submitKalshiBuy(supabase, userId, {
          ticker,
          side: toSide,
          contracts,
          limitPriceCents: limitCents,
          strike,
          spot,
          stakeUsd: (contracts * limitCents) / 100,
          inputsSnapshot: {
            source: "big_flip_detector",
            yes_delta: big.delta,
            prev_yes: prevSample.yes_cents,
            new_yes: flipSample.yes_cents,
            seconds_to_close: stc,
            flip_at: flipAt,
          },
        });
      }
    } catch (e) {
      console.error("[bigFlipDetector] live order failed:", (e as Error)?.message);
    }
  }

  return {
    ok: true, ticker, toSide,
    prevYes: prevSample.yes_cents as number,
    newYes: flipSample.yes_cents as number,
    yesDelta: big.delta,
    spot, strike, secondsToClose: stc,
    flipAt, passed, rejectReason: reject, ageSeconds,
  };
}

export const detectBigFlip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BigFlipSignal> => {
    return runBigFlipForUser(context.supabase, context.userId);
  });
