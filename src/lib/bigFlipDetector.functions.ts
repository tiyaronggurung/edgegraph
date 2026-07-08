import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Detects "big flips": one-tick YES delta >= 25c with confirming conditions.
// Shadow-log only. Writes qualifying flips to big_flip_signals and returns the
// latest signal so the UI can render a banner. Does NOT place any trades.

const YES_DELTA_MIN = 25;
const MIN_SECONDS_TO_CLOSE = 180;
const NO_OPPOSITE_FLIP_WINDOW_SEC = 300; // 5 min

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

export const detectBigFlip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BigFlipSignal> => {
    // Get last row for the user's active ticker.
    const { data: latestRow } = await context.supabase
      .from("btc_odds_tape")
      .select("ticker")
      .eq("user_id", context.userId)
      .order("snapped_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestRow?.ticker) return empty;
    const ticker = latestRow.ticker as string;

    // Pull last 40 samples on this ticker (~ last 2 min at ~3s cadence).
    const { data: rows } = await context.supabase
      .from("btc_odds_tape")
      .select("yes_cents,no_cents,spot,strike,seconds_to_close,snapped_at")
      .eq("user_id", context.userId)
      .eq("ticker", ticker)
      .order("snapped_at", { ascending: false })
      .limit(40);
    const samples = (rows ?? []).slice().reverse();
    if (samples.length < 2) return { ...empty, ok: true, ticker };

    // Scan pairwise for the most recent big one-tick move.
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

    // Rules gate.
    let passed = true;
    let reject: string | null = null;
    // 1. delta magnitude — already >= 25 by construction.
    // 2. spot on new leader's side of strike.
    if (toSide === "YES" && spot <= strike) { passed = false; reject = "spot not above strike for YES flip"; }
    else if (toSide === "NO" && spot >= strike) { passed = false; reject = "spot not below strike for NO flip"; }
    // 3. seconds to close.
    else if (stc < MIN_SECONDS_TO_CLOSE) { passed = false; reject = `only ${stc}s to close`; }
    // 4. no opposite flip on this ticker in prior 5 min.
    else {
      const cutoff = new Date(new Date(flipAt).getTime() - NO_OPPOSITE_FLIP_WINDOW_SEC * 1000).toISOString();
      const { data: prior } = await context.supabase
        .from("big_flip_signals")
        .select("to_side, flip_at")
        .eq("user_id", context.userId)
        .eq("ticker", ticker)
        .gte("flip_at", cutoff)
        .lt("flip_at", flipAt)
        .order("flip_at", { ascending: false })
        .limit(1);
      const priorOpposite = (prior ?? []).some(p => (p.to_side as string) !== toSide);
      if (priorOpposite) { passed = false; reject = "opposite flip within 5 min"; }
    }

    // Idempotent insert (unique on user+ticker+flip_at).
    await context.supabase.from("big_flip_signals").insert({
      user_id: context.userId,
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

    return {
      ok: true, ticker, toSide,
      prevYes: prevSample.yes_cents as number,
      newYes: flipSample.yes_cents as number,
      yesDelta: big.delta,
      spot, strike, secondsToClose: stc,
      flipAt, passed, rejectReason: reject, ageSeconds,
    };
  });
