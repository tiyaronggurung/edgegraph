// Conviction-decay exit shadow study — READ-ONLY.
// Never mutates live behavior; never gates auto-odds exits. Provides:
//   1. backfillConvictionExitOutcomes — fills settled_pnl / settled_outcome on
//      auto_odds_conviction_exit_shadow rows once their auto_trade_orders row
//      has settled_win/settled_loss.
//   2. getConvictionExitStudy — per-threshold (0.10 / 0.15 / 0.20) comparison
//      of hold-to-settlement vs first-time hypothetical exit, avoided-loss vs
//      forfeited-win dollars, splits by side/time/ask band, readiness gates.
//
// One "trade" = one order_id. For a would-exit threshold T:
//   - hypothetical_exit_pnl = shadow row that fired first for that order (T).
//   - hold_pnl = settled_pnl on the auto_trade_orders row.
//   - avoided_loss  = hold negative that we would've cut short.
//   - forfeited_win = hold positive that we would've cut short.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const THRESHOLDS = ["010", "015", "020"] as const;
type Thr = (typeof THRESHOLDS)[number];

interface ShadowRow {
  id: string;
  order_id: string;
  user_id: string;
  ticker: string;
  tick_at: string;
  created_at: string;
  seconds_since_entry: number | null;
  seconds_to_close: number | null;
  entry_prob: number | null;
  current_prob: number | null;
  prob_drop: number | null;
  entry_ask_cents: number | null;
  current_bid_cents: number | null;
  would_exit_010: boolean | null;
  would_exit_015: boolean | null;
  would_exit_020: boolean | null;
  hypothetical_exit_pnl: number | null;
  settled_pnl: number | null;
  settled_outcome: string | null;
}

// ── 1. Backfill ──────────────────────────────────────────────────────────────
export const backfillConvictionExitOutcomes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await (supabase as any)
      .from("auto_odds_conviction_exit_shadow")
      .select("id, order_id")
      .is("settled_pnl", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (!rows || rows.length === 0) return { ok: true, backfilled: 0 };

    const orderIds = [...new Set(rows.map((r: any) => r.order_id))];
    const { data: orders } = await supabaseAdmin
      .from("auto_trade_orders")
      .select("id, pnl_usd, status")
      .in("id", orderIds)
      .in("status", ["settled_win", "settled_loss"]);

    const byOrder = new Map<string, { pnl: number; status: string }>();
    for (const o of orders ?? []) {
      byOrder.set((o as any).id, {
        pnl: Number((o as any).pnl_usd ?? 0),
        status: (o as any).status,
      });
    }

    let updated = 0;
    for (const r of rows as any[]) {
      const rec = byOrder.get(r.order_id);
      if (!rec) continue;
      const { error } = await (supabaseAdmin as any)
        .from("auto_odds_conviction_exit_shadow")
        .update({
          settled_pnl: rec.pnl,
          settled_outcome: rec.status === "settled_win" ? "win" : "loss",
        })
        .eq("id", r.id);
      if (!error) updated += 1;
    }
    return { ok: true, backfilled: updated };
  });

// ── 2. Study ─────────────────────────────────────────────────────────────────
interface ThresholdResult {
  thr: Thr;
  trades_touched: number;          // orders that had ≥1 shadow row
  fired: number;                   // orders where flag ever fired
  fire_rate_pct: number;
  hold_pnl_total: number;          // sum settled_pnl over fired orders
  hypo_pnl_total: number;          // sum first-fire hypothetical_exit_pnl over fired orders
  delta_pnl: number;               // hypo - hold
  avoided_loss_dollars: number;    // sum of |hold_pnl| where hold<0
  forfeited_win_dollars: number;   // sum of hold_pnl where hold>0
  net_effect: number;              // avoided_loss - forfeited_win
  trade_retention_pct: number;     // (touched - fired) / touched
}

interface SideSlice { side: "YES" | "NO"; fired: number; avoided_loss: number; forfeited_win: number; net: number; }
interface TimeSlice { bucket: string; fired: number; avoided_loss: number; forfeited_win: number; net: number; }
interface AskSlice { band: string; fired: number; avoided_loss: number; forfeited_win: number; net: number; }
interface DaySlice { day: string; fired: number; avoided_loss: number; forfeited_win: number; net: number; }

interface Readiness {
  min_trades: { need: 200; have: number; ok: boolean };
  min_days: { need: 5; have: number; ok: boolean };
  per_threshold: Record<string, { fired: number; ok: boolean }>;
  all_gates_pass: boolean;
}

export interface ConvictionExitStudy {
  as_of: string;
  total_shadow_rows: number;
  trades_touched: number;
  day_count: number;
  readiness: Readiness;
  by_threshold: ThresholdResult[];
  by_side: Record<string, SideSlice[]>;
  by_time_bucket: Record<string, TimeSlice[]>;
  by_ask: Record<string, AskSlice[]>;
  by_day: Record<string, DaySlice[]>;
}

function askBandOf(cents: number | null): string {
  if (cents == null) return "unknown";
  if (cents < 78) return "01 <78";
  if (cents < 83) return "02 78-82";
  if (cents < 87) return "03 83-86";
  return "04 87+";
}
function timeBucketOf(secs: number | null): string {
  if (secs == null) return "unknown";
  if (secs > 480) return "01 >480s";
  if (secs > 300) return "02 300-480s";
  if (secs > 120) return "03 120-300s";
  return "04 <=120s";
}

export const getConvictionExitStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConvictionExitStudy> => {
    const { supabase } = context;

    const { data: raw } = await (supabase as any)
      .from("auto_odds_conviction_exit_shadow")
      .select("id, order_id, user_id, ticker, tick_at, created_at, seconds_since_entry, seconds_to_close, entry_prob, current_prob, prob_drop, entry_ask_cents, current_bid_cents, would_exit_010, would_exit_015, would_exit_020, hypothetical_exit_pnl, settled_pnl, settled_outcome")
      .order("tick_at", { ascending: true })
      .limit(50000);
    const rows: ShadowRow[] = (raw ?? []) as any[];

    // Group by order_id.
    const byOrder = new Map<string, ShadowRow[]>();
    for (const r of rows) {
      const arr = byOrder.get(r.order_id) ?? [];
      arr.push(r);
      byOrder.set(r.order_id, arr);
    }

    // Look up order side / created_at from auto_trade_orders for splits.
    const orderIds = [...byOrder.keys()];
    const orderMeta = new Map<string, { side: "YES" | "NO"; created_at: string }>();
    if (orderIds.length > 0) {
      const { data: ordersRaw } = await (supabase as any)
        .from("auto_trade_orders")
        .select("id, side, created_at")
        .in("id", orderIds);
      for (const o of ordersRaw ?? []) {
        orderMeta.set((o as any).id, {
          side: (o as any).side,
          created_at: (o as any).created_at,
        });
      }
    }

    const dayKey = (iso: string) => iso.slice(0, 10);
    const daySet = new Set<string>();

    const byThreshold: ThresholdResult[] = THRESHOLDS.map(thr => {
      const flagKey = `would_exit_${thr}` as keyof ShadowRow;
      let fired = 0;
      let holdSum = 0;
      let hypoSum = 0;
      let avoidedLoss = 0;
      let forfeitedWin = 0;
      let touched = 0;

      for (const [, arr] of byOrder) {
        // Require settled_pnl on at least one row for meaningful comparison.
        const settled = arr.find(r => r.settled_pnl != null);
        if (!settled) continue;
        touched += 1;
        // First fire.
        const firstFire = arr.find(r => (r as any)[flagKey] === true && r.hypothetical_exit_pnl != null);
        if (!firstFire) continue;
        fired += 1;
        const hold = Number(settled.settled_pnl);
        const hypo = Number(firstFire.hypothetical_exit_pnl);
        holdSum += hold;
        hypoSum += hypo;
        if (hold < 0) avoidedLoss += Math.abs(hold);
        else if (hold > 0) forfeitedWin += hold;
      }

      return {
        thr,
        trades_touched: touched,
        fired,
        fire_rate_pct: touched ? (fired / touched) * 100 : 0,
        hold_pnl_total: holdSum,
        hypo_pnl_total: hypoSum,
        delta_pnl: hypoSum - holdSum,
        avoided_loss_dollars: avoidedLoss,
        forfeited_win_dollars: forfeitedWin,
        net_effect: avoidedLoss - forfeitedWin,
        trade_retention_pct: touched ? ((touched - fired) / touched) * 100 : 100,
      };
    });

    // Splits per threshold.
    const bySide: Record<string, SideSlice[]> = {};
    const byTime: Record<string, TimeSlice[]> = {};
    const byAsk: Record<string, AskSlice[]> = {};
    const byDay: Record<string, DaySlice[]> = {};

    for (const thr of THRESHOLDS) {
      const flagKey = `would_exit_${thr}` as keyof ShadowRow;
      const sm = new Map<string, SideSlice>();
      const tm = new Map<string, TimeSlice>();
      const am = new Map<string, AskSlice>();
      const dm = new Map<string, DaySlice>();

      for (const [oid, arr] of byOrder) {
        const settled = arr.find(r => r.settled_pnl != null);
        if (!settled) continue;
        const firstFire = arr.find(r => (r as any)[flagKey] === true && r.hypothetical_exit_pnl != null);
        if (!firstFire) continue;
        const hold = Number(settled.settled_pnl);
        const meta = orderMeta.get(oid);
        const side = (meta?.side as "YES" | "NO") ?? "YES";
        const bucket = timeBucketOf(firstFire.seconds_to_close);
        const askB = askBandOf(firstFire.entry_ask_cents);
        const day = dayKey(meta?.created_at ?? firstFire.tick_at);
        daySet.add(day);
        const bump = <T extends { fired: number; avoided_loss: number; forfeited_win: number; net: number }>(x: T) => {
          x.fired += 1;
          if (hold < 0) x.avoided_loss += Math.abs(hold);
          else if (hold > 0) x.forfeited_win += hold;
          x.net = x.avoided_loss - x.forfeited_win;
          return x;
        };
        sm.set(side, bump(sm.get(side) ?? { side, fired: 0, avoided_loss: 0, forfeited_win: 0, net: 0 }));
        tm.set(bucket, bump(tm.get(bucket) ?? { bucket, fired: 0, avoided_loss: 0, forfeited_win: 0, net: 0 }));
        am.set(askB, bump(am.get(askB) ?? { band: askB, fired: 0, avoided_loss: 0, forfeited_win: 0, net: 0 }));
        dm.set(day, bump(dm.get(day) ?? { day, fired: 0, avoided_loss: 0, forfeited_win: 0, net: 0 }));
      }
      bySide[thr] = [...sm.values()];
      byTime[thr] = [...tm.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
      byAsk[thr] = [...am.values()].sort((a, b) => a.band.localeCompare(b.band));
      byDay[thr] = [...dm.values()].sort((a, b) => a.day.localeCompare(b.day));
    }

    // Readiness.
    const touchedTotal = byThreshold[0]?.trades_touched ?? 0;
    const perThr: Record<string, { fired: number; ok: boolean }> = {};
    for (const t of byThreshold) perThr[t.thr] = { fired: t.fired, ok: t.fired >= 30 };
    const readiness: Readiness = {
      min_trades: { need: 200, have: touchedTotal, ok: touchedTotal >= 200 },
      min_days: { need: 5, have: daySet.size, ok: daySet.size >= 5 },
      per_threshold: perThr,
      all_gates_pass:
        touchedTotal >= 200 &&
        daySet.size >= 5 &&
        Object.values(perThr).every(v => v.ok),
    };

    return {
      as_of: new Date().toISOString(),
      total_shadow_rows: rows.length,
      trades_touched: touchedTotal,
      day_count: daySet.size,
      readiness,
      by_threshold: byThreshold,
      by_side: bySide,
      by_time_bucket: byTime,
      by_ask: byAsk,
      by_day: byDay,
    };
  });
