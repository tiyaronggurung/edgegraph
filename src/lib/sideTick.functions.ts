// Records per-window ~10s pill snapshots into btc_side_ticks and provides
// a backfill that sets btc_model_predictions.study_locked_side to the
// side that was live at the 7-8 min mark (secondsToClose closest to 450).
//
// Never touches paper_fills, big flip hunter, or auto-trade paths.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TickInput = z.object({
  ticker: z.string().min(1),
  secondsToClose: z.number().int(),
  closeTime: z.string().optional().nullable(),
  spot: z.number().nullable().optional(),
  strike: z.number().nullable().optional(),
  midPrice: z.number().nullable().optional(),
  buyPrice: z.number().nullable().optional(),
  sellPrice: z.number().nullable().optional(),
  recoSide: z.enum(["UP", "DOWN", "WAIT"]).nullable().optional(),
  recoConfPct: z.number().nullable().optional(),
  memScore: z.number().nullable().optional(),
  aboveStrikeRatio90s: z.number().nullable().optional(),
});

export const recordSideTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TickInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("btc_side_ticks").insert({
      ticker: data.ticker,
      seconds_to_close: data.secondsToClose,
      close_time: data.closeTime ?? null,
      spot: data.spot ?? null,
      strike: data.strike ?? null,
      mid_price: data.midPrice ?? null,
      buy_price: data.buyPrice ?? null,
      sell_price: data.sellPrice ?? null,
      reco_side: data.recoSide ?? null,
      reco_conf_pct: data.recoConfPct ?? null,
      mem_score: data.memScore ?? null,
      above_strike_ratio_90s: data.aboveStrikeRatio90s ?? null,
      source: "client",
      user_id: userId,
    } as never);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });

// Backfills study_locked_side for past windows using the tick closest to
// secondsToClose = 450 (7:30 mark). Only overwrites rows whose current
// study_lock_seconds_to_close is null OR > 480 (early lock). Never touches
// rows locked strictly at the 7-min mark already.
const BackfillInput = z.object({
  sinceHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
  onlyEarlyLocks: z.boolean().default(true),
});

export const backfillStudyLocksFromTicks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BackfillInput.parse(d))
  .handler(async ({ data, context }) => {
    // Admin-gated: verify caller is admin before mutating other users' rows.
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof?.is_admin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.sinceHours * 3600_000).toISOString();

    // Fetch candidate predictions.
    let q = supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, close_time, study_locked_side, study_lock_seconds_to_close")
      .gte("close_time", since)
      .lte("close_time", new Date().toISOString());
    if (data.onlyEarlyLocks) {
      q = q.or("study_lock_seconds_to_close.is.null,study_lock_seconds_to_close.gt.480");
    }
    const { data: preds, error: pErr } = await q;
    if (pErr) return { ok: false, error: pErr.message };

    let scanned = 0;
    let updated = 0;
    let noTick = 0;

    for (const p of preds ?? []) {
      scanned++;
      // Pick tick with seconds_to_close closest to 450, within (420,480].
      const { data: ticks } = await supabaseAdmin
        .from("btc_side_ticks")
        .select("reco_side, reco_conf_pct, seconds_to_close, evaluated_at")
        .eq("ticker", (p as any).ticker)
        .lte("seconds_to_close", 480)
        .gt("seconds_to_close", 420)
        .not("reco_side", "is", null)
        .neq("reco_side", "WAIT")
        .order("evaluated_at", { ascending: true })
        .limit(50);

      if (!ticks || !ticks.length) { noTick++; continue; }

      // Pick the one closest to 450s to close.
      const best = ticks.reduce((acc: any, r: any) =>
        Math.abs((r.seconds_to_close ?? 9999) - 450) <
        Math.abs((acc.seconds_to_close ?? 9999) - 450) ? r : acc);

      const yesNo = best.reco_side === "UP" ? "YES" : "NO";
      const { error: upErr } = await supabaseAdmin
        .from("btc_model_predictions")
        .update({
          study_locked_side: yesNo,
          study_lock_confidence: best.reco_conf_pct ?? null,
          study_lock_source: "backfill_7min_tick",
          study_lock_seconds_to_close: best.seconds_to_close,
          study_locked_at: best.evaluated_at,
        } as never)
        .eq("ticker", (p as any).ticker);
      if (!upErr) updated++;
    }

    return { ok: true, scanned, updated, noTick };
  });
