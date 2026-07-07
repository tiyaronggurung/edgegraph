import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Shadow Flip Exit Study — NO LIVE TRADING IMPACT.
// Replays btc_odds_tape for each settled auto-trade odds bet and computes
// what would have happened if we had exited the moment our-side mark first
// crossed 45¢ / 40¢ / 35¢ / 30¢.

const THRESHOLDS = [45, 40, 35, 30] as const;
type Threshold = typeof THRESHOLDS[number];

interface SimResult {
  first_cross_mark: number | null;
  first_cross_secs: number | null;
  sim_exit_cents: number | null;
  sim_pnl: number;
  saved_loss: boolean;
  killed_winner: boolean;
}

function simulateThreshold(
  tape: Array<{ our_side_cents: number; seconds_to_close: number }>,
  threshold: number,
  entryCents: number,
  contracts: number,
  actualPnl: number,
): SimResult {
  let hit: { mark: number; secs: number } | null = null;
  for (const s of tape) {
    if (s.our_side_cents < threshold) {
      hit = { mark: s.our_side_cents, secs: s.seconds_to_close };
      break;
    }
  }
  if (!hit) {
    return {
      first_cross_mark: null,
      first_cross_secs: null,
      sim_exit_cents: null,
      sim_pnl: actualPnl,
      saved_loss: false,
      killed_winner: false,
    };
  }
  const simExit = hit.mark;
  const simPnl = (contracts * (simExit - entryCents)) / 100;
  return {
    first_cross_mark: hit.mark,
    first_cross_secs: hit.secs,
    sim_exit_cents: simExit,
    sim_pnl: simPnl,
    saved_loss: actualPnl < 0 && simPnl > actualPnl,
    killed_winner: actualPnl > 0 && simPnl < actualPnl - 0.01,
  };
}

/**
 * Recompute the shadow rows for all settled tracked auto-odds trades for
 * the current user. Idempotent: upserts on order_id.
 */
export const recomputeFlipShadow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Pull settled tracked orders joined to auto_trade_orders.
    const { data: tracked, error: tErr } = await supabase
      .from("auto_odds_tracked_orders")
      .select("order_id")
      .eq("user_id", userId);
    if (tErr) return { ok: false as const, error: tErr.message };
    const orderIds = (tracked ?? []).map((r: any) => r.order_id);
    if (orderIds.length === 0) return { ok: true as const, computed: 0, total: 0 };

    const { data: orders, error: oErr } = await supabase
      .from("auto_trade_orders")
      .select("id, ticker, side, entry_price_cents, limit_cents, contracts, status, pnl_usd, created_at, settled_at")
      .in("id", orderIds)
      .in("status", ["settled_win", "settled_loss"]);
    if (oErr) return { ok: false as const, error: oErr.message };

    const settled = (orders ?? []).filter((o: any) => o.settled_at != null);
    let computed = 0;
    const rowsToUpsert: any[] = [];

    for (const o of settled) {
      const side: string = o.side;
      const entryCents: number = o.entry_price_cents ?? o.limit_cents;
      const contracts: number = o.contracts;
      const actualPnl: number = Number(o.pnl_usd ?? 0);
      const placedAt = o.created_at;
      const settledAt = o.settled_at;

      // Fetch tape between placed and settled for this ticker.
      const { data: tape } = await supabase
        .from("btc_odds_tape")
        .select("yes_cents, no_cents, seconds_to_close, snapped_at")
        .eq("ticker", o.ticker)
        .gte("snapped_at", placedAt)
        .lte("snapped_at", settledAt)
        .order("snapped_at", { ascending: true })
        .limit(2000);

      const tapeRows = (tape ?? []).map((t: any) => ({
        our_side_cents: side === "YES" ? (t.yes_cents ?? 0) : (t.no_cents ?? 0),
        seconds_to_close: t.seconds_to_close ?? 0,
      }));

      const minMark = tapeRows.length > 0
        ? tapeRows.reduce((m, r) => Math.min(m, r.our_side_cents), 999)
        : null;

      const sims: Record<Threshold, SimResult> = {} as any;
      for (const T of THRESHOLDS) {
        sims[T] = simulateThreshold(tapeRows, T, entryCents, contracts, actualPnl);
      }

      rowsToUpsert.push({
        user_id: userId,
        order_id: o.id,
        ticker: o.ticker,
        side,
        entry_cents: entryCents,
        contracts,
        placed_at: placedAt,
        settled_at: settledAt,
        actual_outcome: o.status,
        actual_pnl: actualPnl,
        min_mark_seen: minMark,
        tape_samples: tapeRows.length,

        t45_first_cross_mark: sims[45].first_cross_mark,
        t45_first_cross_secs: sims[45].first_cross_secs,
        t45_sim_exit_cents: sims[45].sim_exit_cents,
        t45_sim_pnl: sims[45].sim_pnl,
        t45_saved_loss: sims[45].saved_loss,
        t45_killed_winner: sims[45].killed_winner,

        t40_first_cross_mark: sims[40].first_cross_mark,
        t40_first_cross_secs: sims[40].first_cross_secs,
        t40_sim_exit_cents: sims[40].sim_exit_cents,
        t40_sim_pnl: sims[40].sim_pnl,
        t40_saved_loss: sims[40].saved_loss,
        t40_killed_winner: sims[40].killed_winner,

        t35_first_cross_mark: sims[35].first_cross_mark,
        t35_first_cross_secs: sims[35].first_cross_secs,
        t35_sim_exit_cents: sims[35].sim_exit_cents,
        t35_sim_pnl: sims[35].sim_pnl,
        t35_saved_loss: sims[35].saved_loss,
        t35_killed_winner: sims[35].killed_winner,

        t30_first_cross_mark: sims[30].first_cross_mark,
        t30_first_cross_secs: sims[30].first_cross_secs,
        t30_sim_exit_cents: sims[30].sim_exit_cents,
        t30_sim_pnl: sims[30].sim_pnl,
        t30_saved_loss: sims[30].saved_loss,
        t30_killed_winner: sims[30].killed_winner,

        computed_at: new Date().toISOString(),
      });
      computed += 1;
    }

    if (rowsToUpsert.length > 0) {
      // Upsert in chunks
      const CHUNK = 100;
      for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
        const chunk = rowsToUpsert.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("auto_trade_flip_shadow")
          .upsert(chunk, { onConflict: "order_id" });
        if (error) return { ok: false as const, error: error.message, computed };
      }
    }

    return { ok: true as const, computed, total: settled.length };
  });

export interface FlipShadowThresholdStats {
  threshold: number;
  exits: number;
  losses_saved: number;
  winners_killed: number;
  actual_pnl: number;
  sim_pnl: number;
  delta_pnl: number;
}

export interface FlipShadowReport {
  totalSettled: number;
  actualPnl: number;
  thresholds: FlipShadowThresholdStats[];
}

/**
 * Aggregate the shadow rows into per-threshold stats.
 */
export const getFlipShadowReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlipShadowReport> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("auto_trade_flip_shadow")
      .select("*")
      .eq("user_id", userId)
      .order("settled_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const rows = data ?? [];

    const actualPnl = rows.reduce((s: number, r: any) => s + Number(r.actual_pnl ?? 0), 0);

    const stats: FlipShadowThresholdStats[] = THRESHOLDS.map((T) => {
      const markKey = `t${T}_first_cross_mark`;
      const simKey = `t${T}_sim_pnl`;
      const savedKey = `t${T}_saved_loss`;
      const killedKey = `t${T}_killed_winner`;

      let exits = 0, saved = 0, killed = 0, simPnl = 0;
      for (const r of rows as any[]) {
        if (r[markKey] != null) exits += 1;
        if (r[savedKey]) saved += 1;
        if (r[killedKey]) killed += 1;
        simPnl += Number(r[simKey] ?? 0);
      }
      return {
        threshold: T,
        exits,
        losses_saved: saved,
        winners_killed: killed,
        actual_pnl: actualPnl,
        sim_pnl: simPnl,
        delta_pnl: simPnl - actualPnl,
      };
    });

    return {
      totalSettled: rows.length,
      actualPnl,
      thresholds: stats,
    };
  });
