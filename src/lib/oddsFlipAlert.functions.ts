import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Reads the last ~15 odds-tape snapshots for the user's most-recent ATM ticker
// and reports whether the leader side has flipped across the 50¢ line within
// that window. Display-only: does not affect any trading logic.

export interface OddsFlipResult {
  ok: boolean;
  ticker: string | null;
  sampled: number;
  latestYes: number | null;
  latestNo: number | null;
  latestSide: "YES" | "NO" | "EVEN" | null;
  flipped: boolean;
  fromSide: "YES" | "NO" | null;
  toSide: "YES" | "NO" | null;
  crossedAt: string | null;   // ISO timestamp of the sample that crossed 50¢
  crossedYesCents: number | null;
  latestAt: string | null;
  windowMinutes: number;
}

export const getRecentOddsFlip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OddsFlipResult> => {
    // Latest tape row → gives us the active ticker.
    const { data: latestRow, error: latestErr } = await context.supabase
      .from("btc_odds_tape")
      .select("ticker, yes_cents, no_cents, snapped_at")
      .eq("user_id", context.userId)
      .order("snapped_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr || !latestRow) {
      return {
        ok: false, ticker: null, sampled: 0,
        latestYes: null, latestNo: null, latestSide: null,
        flipped: false, fromSide: null, toSide: null,
        crossedAt: null, crossedYesCents: null, latestAt: null,
        windowMinutes: 15,
      };
    }

    // Last 15 samples on that ticker, oldest → newest.
    const { data: rows } = await context.supabase
      .from("btc_odds_tape")
      .select("yes_cents, no_cents, snapped_at")
      .eq("user_id", context.userId)
      .eq("ticker", latestRow.ticker)
      .order("snapped_at", { ascending: false })
      .limit(15);

    const samples = (rows ?? []).slice().reverse();
    const latestYes = latestRow.yes_cents as number;
    const latestNo = latestRow.no_cents as number;
    const latestSide: "YES" | "NO" | "EVEN" =
      latestYes > 50 ? "YES" : latestYes < 50 ? "NO" : "EVEN";

    // Walk the window: a flip = at some earlier sample the leader was on the
    // OTHER side of 50¢ vs the latest sample. We report the earliest crossing.
    let flipped = false;
    let fromSide: "YES" | "NO" | null = null;
    let crossedAt: string | null = null;
    let crossedYes: number | null = null;

    if (latestSide !== "EVEN" && samples.length >= 3) {
      const targetSide = latestSide; // "YES" or "NO"
      // Find last sample where leader was the opposite side, then the next
      // sample after it is the crossing point.
      for (let i = samples.length - 2; i >= 0; i--) {
        const y = samples[i].yes_cents as number;
        const side = y > 50 ? "YES" : y < 50 ? "NO" : "EVEN";
        if (side !== "EVEN" && side !== targetSide) {
          flipped = true;
          fromSide = side;
          const cross = samples[i + 1];
          crossedAt = cross.snapped_at as string;
          crossedYes = cross.yes_cents as number;
          break;
        }
      }
    }

    return {
      ok: true,
      ticker: latestRow.ticker,
      sampled: samples.length,
      latestYes,
      latestNo,
      latestSide,
      flipped,
      fromSide,
      toSide: flipped ? latestSide as "YES" | "NO" : null,
      crossedAt,
      crossedYesCents: crossedYes,
      latestAt: latestRow.snapped_at as string,
      windowMinutes: 15,
    };
  });
