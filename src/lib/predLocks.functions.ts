import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * PRED lock persistence (server-side, device-independent).
 *
 * Purpose: PRED verdicts used to live only in the current browser's
 * localStorage. That made backtesting PRED / PRED v2 impossible across
 * devices and after cache clears. These server fns persist the exact
 * lock-time snapshot per (user, window_start, ticker) so future studies
 * can replay both strategies against real historical fires.
 *
 * Zero behavior change to PRED gates, stake, or auto-trade logic.
 */

const SavePredLockInput = z.object({
  ticker: z.string().min(1),
  window_start: z.string().min(1), // ISO
  side: z.enum(["UP", "DOWN", "SKIP"]),
  ask: z.number().nullable().optional(),
  edge: z.number().nullable().optional(),
  side_conf: z.number().nullable().optional(),
  spot: z.number().nullable().optional(),
  strike: z.number().nullable().optional(),
  time_left_sec: z.number().int().nullable().optional(),
  v1_fired: z.boolean().optional(),
  v2_action: z.string().nullable().optional(),
  v2_side: z.string().nullable().optional(),
  v2_reason: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const savePredLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SavePredLockInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("pred_locks").upsert(
      {
        user_id: userId,
        ticker: data.ticker,
        window_start: data.window_start,
        side: data.side,
        ask: data.ask ?? null,
        edge: data.edge ?? null,
        side_conf: data.side_conf ?? null,
        spot: data.spot ?? null,
        strike: data.strike ?? null,
        time_left_sec: data.time_left_sec ?? null,
        v1_fired: data.v1_fired ?? false,
        v2_action: data.v2_action ?? null,
        v2_side: data.v2_side ?? null,
        v2_reason: data.v2_reason ?? null,
        meta: (data.meta ?? {}) as never,
      },
      { onConflict: "user_id,window_start,ticker", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPredLocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("pred_locks")
      .select(
        "ticker, window_start, side, ask, edge, side_conf, v1_fired, v2_action, v2_side, v2_reason, locked_at",
      )
      .gte("window_start", since)
      .order("window_start", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });
