import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    return { ok: true as const, inserted: rows.length };
  });
