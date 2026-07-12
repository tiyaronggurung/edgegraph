// Signed-edge veto shadow study — READ-ONLY.
// Never mutates live behavior; never gates auto-odds. Provides:
//   1. backfillDecisionLogOutcomes — fills final_outcome, theoretical_pnl_100,
//      and realized_pnl_usd on auto_odds_decision_log rows once markets settle.
//   2. getSignedEdgeVetoStudy — returns the shadow comparison used by the
//      SignedEdgeVetoPanel: per-threshold P/L, readiness gates, splits.
//
// P/L convention:
//   Win  → 100 * (100 - entry_cents) / entry_cents      (Kalshi $100 flat)
//   Loss → -100
//   ROC  = net / (100 * n)

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const THRESHOLDS = [0.03, 0.05, 0.08] as const;
type Thr = (typeof THRESHOLDS)[number];

interface Row {
  id: string;
  created_at: string;
  ticker: string;
  picked_side: "YES" | "NO";
  seconds_to_close: number | null;
  model_side_prob: number | null;
  entry_price_cents: number | null;
  signed_edge: number | null;
  confidence_score: number | null;
  odds_band_eligible: boolean | null;
  actual_entered: boolean;
  order_id: string | null;
  final_outcome: string | null;
  theoretical_pnl_100: number | null;
  realized_pnl_usd: number | null;
}

function pnl100(entryCents: number, won: boolean): number {
  if (won) return (100 * (100 - entryCents)) / entryCents;
  return -100;
}

// ── 1. Backfill ─────────────────────────────────────────────────────────────
export const backfillDecisionLogOutcomes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pull rows still missing outcome (limit batch for cron safety).
    const { data: rows } = await supabase
      .from("auto_odds_decision_log")
      .select("id, ticker, picked_side, entry_price_cents, actual_entered, order_id, final_outcome, theoretical_pnl_100, realized_pnl_usd")
      .is("final_outcome", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!rows || rows.length === 0) return { ok: true, backfilled: 0 };

    // Fetch outcomes per unique ticker in one shot.
    const tickers = [...new Set(rows.map((r: any) => r.ticker))];
    const { data: preds } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, outcome")
      .in("ticker", tickers)
      .not("outcome", "is", null);
    const outcomeByTicker = new Map<string, string>();
    for (const p of preds ?? []) {
      // most recent wins if duplicates; iterate in order and overwrite is fine
      outcomeByTicker.set((p as any).ticker, (p as any).outcome);
    }

    // Fetch realized P/L for entered rows.
    const orderIds = rows
      .filter((r: any) => r.actual_entered && r.order_id)
      .map((r: any) => r.order_id);
    const pnlByOrder = new Map<string, number>();
    if (orderIds.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from("auto_trade_orders")
        .select("id, pnl_usd, status")
        .in("id", orderIds)
        .in("status", ["settled_win", "settled_loss"]);
      for (const o of orders ?? []) {
        if ((o as any).pnl_usd != null) pnlByOrder.set((o as any).id, Number((o as any).pnl_usd));
      }
    }

    let updated = 0;
    for (const r of rows as any[]) {
      const outcome = outcomeByTicker.get(r.ticker);
      if (!outcome) continue;
      const won = outcome === r.picked_side;
      const theo = r.entry_price_cents ? pnl100(r.entry_price_cents, won) : null;
      const realized = r.order_id ? (pnlByOrder.get(r.order_id) ?? null) : null;
      const patch: {
        final_outcome: string;
        theoretical_pnl_100?: number;
        realized_pnl_usd?: number;
      } = { final_outcome: outcome };
      if (theo !== null) patch.theoretical_pnl_100 = theo;
      if (realized !== null) patch.realized_pnl_usd = realized;
      const { error } = await (supabaseAdmin as any)
        .from("auto_odds_decision_log")
        .update(patch)
        .eq("id", r.id);
      if (!error) updated += 1;
    }
    return { ok: true, backfilled: updated };
  });

// ── 2. Study ─────────────────────────────────────────────────────────────────
interface ThresholdResult {
  thr: Thr;
  windows: number;
  kept: number;
  vetoed: number;
  kept_wins: number;
  kept_losses: number;
  vetoed_wins: number;
  vetoed_losses: number;
  avoided_win_dollars: number;   // $ from wins we skipped (regret)
  avoided_loss_dollars: number;  // $ from losses we skipped (savings — negative number)
  baseline_pnl: number;          // sum over all windows
  kept_pnl: number;              // sum over kept only
  delta_pnl: number;             // kept - baseline
  pnl_per_trade: number;
  roc_pct: number;
  profit_factor: number | null;
  max_drawdown: number;
  worst_losing_streak: number;
  trade_retention_pct: number;
  vetoed_meets_readiness: boolean;
}

interface DaySlice { day: string; baseline_pnl: number; kept_pnl: number; delta: number; kept: number; vetoed: number; }
interface SideSlice { side: "YES" | "NO"; baseline_pnl: number; kept_pnl: number; kept: number; vetoed: number; }
interface AskSlice { band: string; baseline_pnl: number; kept_pnl: number; kept: number; vetoed: number; }
interface TimeSlice { bucket: string; baseline_pnl: number; kept_pnl: number; kept: number; vetoed: number; }
interface CalibSlice { group: "kept" | "vetoed"; avg_model_prob: number; win_rate: number; n: number; }

interface Readiness {
  min_windows: { need: 200; have: number; ok: boolean };
  min_days: { need: 7; have: number; ok: boolean };
  per_threshold: Record<string, { vetoed_windows: number; ok: boolean }>;
  all_gates_pass: boolean;
}

export interface SignedEdgeVetoStudy {
  as_of: string;
  total_rows: number;
  window_count: number;
  day_count: number;
  readiness: Readiness;
  by_threshold: ThresholdResult[];
  by_day: Record<string, DaySlice[]>;              // per-threshold day breakdown
  by_side: Record<string, SideSlice[]>;
  by_ask: Record<string, AskSlice[]>;
  by_time_bucket: Record<string, TimeSlice[]>;
  calibration: Record<string, CalibSlice[]>;
  actual_slice: { entered: number; wins: number; realized_pnl_usd: number };
}

function pfOf(wins: number[], losses: number[]): number | null {
  const g = wins.reduce((s, v) => s + v, 0);
  const l = -losses.reduce((s, v) => s + v, 0);
  if (l <= 0) return g > 0 ? Infinity : null;
  return g / l;
}
function maxDDOf(pnls: number[]): number {
  let peak = 0, cum = 0, dd = 0;
  for (const p of pnls) { cum += p; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; }
  return -dd;
}
function worstLossStreakOf(pnls: number[]): number {
  let cur = 0, worst = 0;
  for (const p of pnls) { if (p < 0) { cur += 1; if (cur > worst) worst = cur; } else cur = 0; }
  return worst;
}
function askBandOf(cents: number): string {
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

export const getSignedEdgeVetoStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SignedEdgeVetoStudy> => {
    const { supabase } = context;
    const { data: raw } = await supabase
      .from("auto_odds_decision_log")
      .select("id, created_at, ticker, picked_side, seconds_to_close, model_side_prob, entry_price_cents, signed_edge, confidence_score, odds_band_eligible, actual_entered, order_id, final_outcome, theoretical_pnl_100, realized_pnl_usd")
      .order("created_at", { ascending: true })
      .limit(20000);

    const rows: Row[] = (raw ?? []) as any[];

    // Window-level dedupe: one row per ticker (earliest).
    const seen = new Set<string>();
    const windows: Row[] = [];
    for (const r of rows) {
      if (seen.has(r.ticker)) continue;
      seen.add(r.ticker);
      windows.push(r);
    }
    // Only windows with a settled outcome AND non-null signed_edge count.
    const evalW = windows.filter(w =>
      w.final_outcome != null &&
      w.entry_price_cents != null &&
      w.signed_edge != null,
    );

    // Baseline P/L per window (pre-computed theoretical_pnl_100; fallback compute).
    const wPnl = new Map<string, number>();
    const wWon = new Map<string, boolean>();
    for (const w of evalW) {
      const won = w.final_outcome === w.picked_side;
      wWon.set(w.id, won);
      const p = w.theoretical_pnl_100 != null
        ? Number(w.theoretical_pnl_100)
        : pnl100(w.entry_price_cents!, won);
      wPnl.set(w.id, p);
    }
    const baselinePnl = evalW.reduce((s, w) => s + (wPnl.get(w.id) ?? 0), 0);
    const dayKey = (iso: string) => iso.slice(0, 10);
    const days = new Set(evalW.map(w => dayKey(w.created_at)));

    // Per-threshold rollup.
    const byThreshold: ThresholdResult[] = THRESHOLDS.map(thr => {
      const kept = evalW.filter(w => (w.signed_edge ?? -Infinity) >= thr);
      const vetoed = evalW.filter(w => (w.signed_edge ?? -Infinity) < thr);
      const keptPnls = kept.map(w => wPnl.get(w.id) ?? 0);
      const vetoedPnls = vetoed.map(w => wPnl.get(w.id) ?? 0);
      const keptWins = keptPnls.filter(p => p > 0);
      const keptLosses = keptPnls.filter(p => p < 0);
      const vetoedWins = vetoedPnls.filter(p => p > 0);
      const vetoedLosses = vetoedPnls.filter(p => p < 0);
      const keptPnl = keptPnls.reduce((s, v) => s + v, 0);
      // Kept P/L ordered chronologically for DD / streak.
      const keptChron = kept
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(w => wPnl.get(w.id) ?? 0);
      return {
        thr,
        windows: evalW.length,
        kept: kept.length,
        vetoed: vetoed.length,
        kept_wins: keptWins.length,
        kept_losses: keptLosses.length,
        vetoed_wins: vetoedWins.length,
        vetoed_losses: vetoedLosses.length,
        avoided_win_dollars: vetoedWins.reduce((s, v) => s + v, 0),
        avoided_loss_dollars: vetoedLosses.reduce((s, v) => s + v, 0),
        baseline_pnl: baselinePnl,
        kept_pnl: keptPnl,
        delta_pnl: keptPnl - baselinePnl,
        pnl_per_trade: kept.length ? keptPnl / kept.length : 0,
        roc_pct: kept.length ? (keptPnl / (100 * kept.length)) * 100 : 0,
        profit_factor: pfOf(keptWins, keptLosses),
        max_drawdown: maxDDOf(keptChron),
        worst_losing_streak: worstLossStreakOf(keptChron),
        trade_retention_pct: evalW.length ? (kept.length / evalW.length) * 100 : 0,
        vetoed_meets_readiness: vetoed.length >= 30,
      };
    });

    // Splits per threshold.
    const byDay: Record<string, DaySlice[]> = {};
    const bySide: Record<string, SideSlice[]> = {};
    const byAsk: Record<string, AskSlice[]> = {};
    const byTimeBucket: Record<string, TimeSlice[]> = {};
    const calibration: Record<string, CalibSlice[]> = {};
    for (const thr of THRESHOLDS) {
      const key = String(thr);
      // by day
      const dm = new Map<string, DaySlice>();
      for (const w of evalW) {
        const d = dayKey(w.created_at);
        const pnl = wPnl.get(w.id) ?? 0;
        const isKept = (w.signed_edge ?? -Infinity) >= thr;
        const row = dm.get(d) ?? { day: d, baseline_pnl: 0, kept_pnl: 0, delta: 0, kept: 0, vetoed: 0 };
        row.baseline_pnl += pnl;
        if (isKept) { row.kept_pnl += pnl; row.kept += 1; } else { row.vetoed += 1; }
        row.delta = row.kept_pnl - row.baseline_pnl;
        dm.set(d, row);
      }
      byDay[key] = [...dm.values()].sort((a, b) => a.day.localeCompare(b.day));
      // by side
      const sm = new Map<string, SideSlice>();
      for (const w of evalW) {
        const s = w.picked_side;
        const pnl = wPnl.get(w.id) ?? 0;
        const isKept = (w.signed_edge ?? -Infinity) >= thr;
        const row = sm.get(s) ?? { side: s, baseline_pnl: 0, kept_pnl: 0, kept: 0, vetoed: 0 };
        row.baseline_pnl += pnl;
        if (isKept) { row.kept_pnl += pnl; row.kept += 1; } else { row.vetoed += 1; }
        sm.set(s, row);
      }
      bySide[key] = [...sm.values()];
      // by ask
      const am = new Map<string, AskSlice>();
      for (const w of evalW) {
        if (w.entry_price_cents == null) continue;
        const b = askBandOf(w.entry_price_cents);
        const pnl = wPnl.get(w.id) ?? 0;
        const isKept = (w.signed_edge ?? -Infinity) >= thr;
        const row = am.get(b) ?? { band: b, baseline_pnl: 0, kept_pnl: 0, kept: 0, vetoed: 0 };
        row.baseline_pnl += pnl;
        if (isKept) { row.kept_pnl += pnl; row.kept += 1; } else { row.vetoed += 1; }
        am.set(b, row);
      }
      byAsk[key] = [...am.values()].sort((a, b) => a.band.localeCompare(b.band));
      // by time bucket
      const tm = new Map<string, TimeSlice>();
      for (const w of evalW) {
        const b = timeBucketOf(w.seconds_to_close);
        const pnl = wPnl.get(w.id) ?? 0;
        const isKept = (w.signed_edge ?? -Infinity) >= thr;
        const row = tm.get(b) ?? { bucket: b, baseline_pnl: 0, kept_pnl: 0, kept: 0, vetoed: 0 };
        row.baseline_pnl += pnl;
        if (isKept) { row.kept_pnl += pnl; row.kept += 1; } else { row.vetoed += 1; }
        tm.set(b, row);
      }
      byTimeBucket[key] = [...tm.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
      // calibration
      const kept = evalW.filter(w => (w.signed_edge ?? -Infinity) >= thr && w.model_side_prob != null);
      const vetoed = evalW.filter(w => (w.signed_edge ?? -Infinity) < thr && w.model_side_prob != null);
      const avg = (arr: Row[], f: (r: Row) => number) => arr.length ? arr.reduce((s, r) => s + f(r), 0) / arr.length : 0;
      calibration[key] = [
        { group: "kept", avg_model_prob: avg(kept, r => Number(r.model_side_prob)), win_rate: kept.length ? kept.filter(r => wWon.get(r.id)).length / kept.length : 0, n: kept.length },
        { group: "vetoed", avg_model_prob: avg(vetoed, r => Number(r.model_side_prob)), win_rate: vetoed.length ? vetoed.filter(r => wWon.get(r.id)).length / vetoed.length : 0, n: vetoed.length },
      ];
    }

    // Readiness gates.
    const perThr: Record<string, { vetoed_windows: number; ok: boolean }> = {};
    for (const t of byThreshold) perThr[String(t.thr)] = { vetoed_windows: t.vetoed, ok: t.vetoed >= 30 };
    const readiness: Readiness = {
      min_windows: { need: 200, have: evalW.length, ok: evalW.length >= 200 },
      min_days: { need: 7, have: days.size, ok: days.size >= 7 },
      per_threshold: perThr,
      all_gates_pass:
        evalW.length >= 200 &&
        days.size >= 7 &&
        Object.values(perThr).every(v => v.ok),
    };

    // Actual live-entered slice.
    const entered = evalW.filter(w => w.actual_entered);
    const enteredWins = entered.filter(w => wWon.get(w.id)).length;
    const realized = entered.reduce((s, w) => s + (w.realized_pnl_usd != null ? Number(w.realized_pnl_usd) : 0), 0);

    return {
      as_of: new Date().toISOString(),
      total_rows: rows.length,
      window_count: evalW.length,
      day_count: days.size,
      readiness,
      by_threshold: byThreshold,
      by_day: byDay,
      by_side: bySide,
      by_ask: byAsk,
      by_time_bucket: byTimeBucket,
      calibration,
      actual_slice: { entered: entered.length, wins: enteredWins, realized_pnl_usd: realized },
    };
  });
