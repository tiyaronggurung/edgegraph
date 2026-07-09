import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateScalpShadow } from "@/lib/scalpShadow.functions";
import { autoExitForUser } from "@/lib/cryptoAutoTrade.functions";

const SnapshotSchema = z.object({
  ticker: z.string().min(1).max(64),
  strike: z.number(),
  spot: z.number(),
  yesCents: z.number().int().min(0).max(100),
  noCents: z.number().int().min(0).max(100),
  secondsToClose: z.number().int(),
});

const InputSchema = z.object({
  snapshots: z.array(SnapshotSchema).min(1).max(50),
});

// Per-user in-memory guard so a slow Kalshi IOC doesn't stack overlapping
// sweeps when the client ticks every ~3s. Worker instance-local — fine
// because the same user's ticks land on the same warm instance in practice,
// and worst case is one duplicate sweep, which is idempotent (claim via
// status='closing' single-flight already handles that).
const inFlightExit = new Set<string>();

export const recordOddsTape = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const rows = data.snapshots.map((s) => ({
      user_id: context.userId,
      ticker: s.ticker,
      strike: s.strike,
      spot: s.spot,
      yes_cents: s.yesCents,
      no_cents: s.noCents,
      seconds_to_close: s.secondsToClose,
    }));
    const { error } = await context.supabase.from("btc_odds_tape").insert(rows);
    if (error) return { ok: false as const, error: error.message };

    // Shadow-only observer. Failures MUST NOT affect the tape response.
    const uniqueTickers = Array.from(new Set(data.snapshots.map((s) => s.ticker)));
    await Promise.all(
      uniqueTickers.map((ticker) =>
        evaluateScalpShadow({ data: { ticker } }).catch(() => undefined),
      ),
    );

    // Fast exit sweep: piggy-back on every tape tick (~3s cadence) so we
    // exit at Kalshi-quote speed instead of waiting for the 1-min cron.
    // Fire-and-forget; overlap-guarded per user; never blocks the response.
    if (!inFlightExit.has(context.userId)) {
      inFlightExit.add(context.userId);
      autoExitForUser(context.supabase, context.userId)
        .catch(() => undefined)
        .finally(() => inFlightExit.delete(context.userId));
    }

    return { ok: true as const, inserted: rows.length };
  });


