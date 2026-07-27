// Per-second snapshots of Kalshi BTC 15m odds vs our own computed odds.
// System-wide log so we can study drift/lead between the two books.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RowSchema = z.object({
  ticker: z.string().min(1).max(120),
  strike: z.number().finite(),
  snap_bucket_sec: z.number().int().nonnegative(),
  seconds_to_close: z.number().int().nullable().optional(),
  kalshi_yes_bid: z.number().nullable().optional(),
  kalshi_yes_ask: z.number().nullable().optional(),
  kalshi_yes_mid: z.number().nullable().optional(),
  kalshi_implied_spot: z.number().nullable().optional(),
  spot_composite: z.number().nullable().optional(),
  our_mid: z.number().nullable().optional(),
  our_up_ask: z.number().nullable().optional(),
  our_down_ask: z.number().nullable().optional(),
  our_sigma: z.number().nullable().optional(),
  our_tilt: z.number().nullable().optional(),
  delta_up: z.number().nullable().optional(),
});

export const insertKalshiOddsSnapshotBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rows: z.infer<typeof RowSchema>[] }) =>
    z.object({ rows: z.array(RowSchema).min(1).max(60) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("btc_kalshi_odds_snapshots")
      .upsert(data.rows, { onConflict: "ticker,snap_bucket_sec", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, inserted: data.rows.length };
  });

export interface OddsSnapshotRow {
  id: number;
  ticker: string;
  strike: number;
  snapped_at: string;
  seconds_to_close: number | null;
  kalshi_yes_bid: number | null;
  kalshi_yes_ask: number | null;
  kalshi_yes_mid: number | null;
  kalshi_implied_spot: number | null;
  spot_composite: number | null;
  our_mid: number | null;
  our_up_ask: number | null;
  our_down_ask: number | null;
  delta_up: number | null;
}

export const listRecentOddsSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ticker?: string; limit?: number } | undefined) =>
    z.object({
      ticker: z.string().min(1).max(120).optional(),
      limit: z.number().int().min(1).max(2000).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: OddsSnapshotRow[] }> => {
    const limit = data.limit ?? 1000;
    let q = context.supabase
      .from("btc_kalshi_odds_snapshots")
      .select("id,ticker,strike,snapped_at,seconds_to_close,kalshi_yes_bid,kalshi_yes_ask,kalshi_yes_mid,kalshi_implied_spot,spot_composite,our_mid,our_up_ask,our_down_ask,delta_up")
      .order("snapped_at", { ascending: false })
      .limit(limit);
    if (data.ticker) q = q.eq("ticker", data.ticker);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as OddsSnapshotRow[] };
  });

export interface OddsWindowStats {
  ticker: string;
  strike: number;
  samples: number;
  first_at: string;
  last_at: string;
  avg_delta_up: number | null;
  abs_avg_delta_up: number | null;
  max_delta_up: number | null;
  min_delta_up: number | null;
  our_up_start: number | null;
  our_up_end: number | null;
  kalshi_up_start: number | null;
  kalshi_up_end: number | null;
}

export const listRecentWindowStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) =>
    z.object({ limit: z.number().int().min(1).max(50).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ windows: OddsWindowStats[] }> => {
    const limit = data.limit ?? 12;
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: raw, error } = await context.supabase
      .from("btc_kalshi_odds_snapshots")
      .select("ticker,strike,snapped_at,kalshi_yes_mid,our_mid,delta_up")
      .gte("snapped_at", since)
      .order("snapped_at", { ascending: true });
    if (error) throw new Error(error.message);
    const by = new Map<string, any[]>();
    for (const r of (raw ?? []) as any[]) {
      const arr = by.get(r.ticker) ?? [];
      arr.push(r);
      by.set(r.ticker, arr);
    }
    const windows: OddsWindowStats[] = [];
    for (const [ticker, arr] of by.entries()) {
      const deltas = arr.map(r => r.delta_up).filter((v: any): v is number => typeof v === "number");
      const sum = deltas.reduce((s, v) => s + v, 0);
      const abs = deltas.reduce((s, v) => s + Math.abs(v), 0);
      windows.push({
        ticker,
        strike: Number(arr[0].strike ?? 0),
        samples: arr.length,
        first_at: arr[0].snapped_at,
        last_at: arr[arr.length - 1].snapped_at,
        avg_delta_up: deltas.length ? sum / deltas.length : null,
        abs_avg_delta_up: deltas.length ? abs / deltas.length : null,
        max_delta_up: deltas.length ? Math.max(...deltas) : null,
        min_delta_up: deltas.length ? Math.min(...deltas) : null,
        our_up_start: arr[0].our_mid ?? null,
        our_up_end: arr[arr.length - 1].our_mid ?? null,
        kalshi_up_start: arr[0].kalshi_yes_mid ?? null,
        kalshi_up_end: arr[arr.length - 1].kalshi_yes_mid ?? null,
      });
    }
    windows.sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
    return { windows: windows.slice(0, limit) };
  });

// ---------------------------------------------------------------------------
// Side Study — for each recently settled window, replay our per-second mid
// to decide which side we "leaned", compare to actual winner (UP/DOWN), and
// produce a hold recommendation for the current live window.
// ---------------------------------------------------------------------------

export interface SideStudyRow {
  ticker: string;
  strike: number;
  close_time: string;
  winner: "UP" | "DOWN" | null;
  samples: number;
  our_up_share: number | null;      // % of samples our_mid > 0.5
  kalshi_up_share: number | null;
  our_final_mid: number | null;     // avg our_mid last 60s
  kalshi_final_mid: number | null;
  our_side: "UP" | "DOWN" | "CHOP" | null;
  kalshi_side: "UP" | "DOWN" | "CHOP" | null;
  our_correct: boolean | null;
  kalshi_correct: boolean | null;
  our_conviction: number | null;    // |mid-0.5|*2 of final
}

export interface LiveHold {
  ticker: string | null;
  strike: number | null;
  seconds_to_close: number | null;
  our_mid: number | null;
  kalshi_mid: number | null;
  recommendation: "HOLD UP" | "HOLD DOWN" | "WAIT" | null;
  confidence: number | null;        // 0..1
  reason: string;
}

export interface SideStudySummary {
  windows: number;
  our_wins: number;
  kalshi_wins: number;
  our_wr: number | null;
  kalshi_wr: number | null;
  agree_wr: number | null;          // WR when ours & kalshi agreed
  disagree_our_wr: number | null;   // WR of ours when they disagreed
  high_conv_wr: number | null;      // ours WR when conviction >= 0.4
}

export const getOddsSideStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; hours?: number } | undefined) =>
    z.object({
      limit: z.number().int().min(1).max(200).optional(),
      hours: z.number().int().min(1).max(72).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: SideStudyRow[]; summary: SideStudySummary; live: LiveHold }> => {
    const hours = data.hours ?? 12;
    const limit = data.limit ?? 40;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    // Pull settled predictions (outcome winner).
    const { data: preds, error: predErr } = await context.supabase
      .from("btc_model_predictions")
      .select("ticker,strike,close_time,outcome,settle_price")
      .gte("close_time", since)
      .not("outcome", "is", null)
      .order("close_time", { ascending: false })
      .limit(limit);
    if (predErr) throw new Error(predErr.message);

    const tickers = (preds ?? []).map(p => p.ticker as string);

    // Pull snapshots for those tickers.
    const { data: snaps, error: snapErr } = await context.supabase
      .from("btc_kalshi_odds_snapshots")
      .select("ticker,snapped_at,seconds_to_close,our_mid,kalshi_yes_mid")
      .in("ticker", tickers.length ? tickers : ["__none__"])
      .order("snapped_at", { ascending: true });
    if (snapErr) throw new Error(snapErr.message);

    const byTicker = new Map<string, any[]>();
    for (const s of (snaps ?? []) as any[]) {
      const arr = byTicker.get(s.ticker) ?? [];
      arr.push(s);
      byTicker.set(s.ticker, arr);
    }

    const CHOP_BAND = 0.04; // within ±4% of 50 = chop
    const rows: SideStudyRow[] = [];
    for (const p of (preds ?? []) as any[]) {
      const arr = byTicker.get(p.ticker) ?? [];
      const winner: "UP" | "DOWN" | null =
        p.outcome === "YES" ? "UP" : p.outcome === "NO" ? "DOWN" : null;
      const our = arr.map(r => Number(r.our_mid)).filter(Number.isFinite);
      const kal = arr.map(r => Number(r.kalshi_yes_mid)).filter(Number.isFinite);
      const ourUpShare = our.length ? our.filter(v => v > 0.5).length / our.length : null;
      const kalUpShare = kal.length ? kal.filter(v => v > 0.5).length / kal.length : null;

      // Final 60s window: seconds_to_close between 0..60
      const finalArr = arr.filter(r => r.seconds_to_close != null && r.seconds_to_close <= 60);
      const ourFinalArr = finalArr.map(r => Number(r.our_mid)).filter(Number.isFinite);
      const kalFinalArr = finalArr.map(r => Number(r.kalshi_yes_mid)).filter(Number.isFinite);
      const ourFinal = ourFinalArr.length ? ourFinalArr.reduce((s, v) => s + v, 0) / ourFinalArr.length : null;
      const kalFinal = kalFinalArr.length ? kalFinalArr.reduce((s, v) => s + v, 0) / kalFinalArr.length : null;

      const sideOf = (m: number | null): "UP" | "DOWN" | "CHOP" | null => {
        if (m == null) return null;
        if (Math.abs(m - 0.5) < CHOP_BAND) return "CHOP";
        return m > 0.5 ? "UP" : "DOWN";
      };
      const ourSide = sideOf(ourFinal);
      const kalSide = sideOf(kalFinal);
      const ourCorrect = winner && ourSide && ourSide !== "CHOP" ? ourSide === winner : null;
      const kalCorrect = winner && kalSide && kalSide !== "CHOP" ? kalSide === winner : null;

      rows.push({
        ticker: p.ticker,
        strike: Number(p.strike),
        close_time: p.close_time,
        winner,
        samples: arr.length,
        our_up_share: ourUpShare,
        kalshi_up_share: kalUpShare,
        our_final_mid: ourFinal,
        kalshi_final_mid: kalFinal,
        our_side: ourSide,
        kalshi_side: kalSide,
        our_correct: ourCorrect,
        kalshi_correct: kalCorrect,
        our_conviction: ourFinal != null ? Math.abs(ourFinal - 0.5) * 2 : null,
      });
    }

    // Summary
    const graded = rows.filter(r => r.winner);
    const ourGraded = graded.filter(r => r.our_correct != null);
    const kalGraded = graded.filter(r => r.kalshi_correct != null);
    const agree = graded.filter(r => r.our_side && r.kalshi_side && r.our_side === r.kalshi_side && r.our_side !== "CHOP");
    const disagree = graded.filter(r => r.our_side && r.kalshi_side && r.our_side !== r.kalshi_side && r.our_side !== "CHOP" && r.kalshi_side !== "CHOP");
    const highConv = ourGraded.filter(r => (r.our_conviction ?? 0) >= 0.4);
    const rate = (arr: SideStudyRow[], key: "our_correct" | "kalshi_correct") => {
      if (!arr.length) return null;
      return arr.filter(r => r[key]).length / arr.length;
    };
    const summary: SideStudySummary = {
      windows: graded.length,
      our_wins: ourGraded.filter(r => r.our_correct).length,
      kalshi_wins: kalGraded.filter(r => r.kalshi_correct).length,
      our_wr: rate(ourGraded, "our_correct"),
      kalshi_wr: rate(kalGraded, "kalshi_correct"),
      agree_wr: rate(agree, "our_correct"),
      disagree_our_wr: rate(disagree, "our_correct"),
      high_conv_wr: rate(highConv, "our_correct"),
    };

    // Live hold recommendation — pick the most recent snapshot (any ticker
    // with a snapshot in the last 30s counts as "current").
    const { data: liveSnap } = await context.supabase
      .from("btc_kalshi_odds_snapshots")
      .select("ticker,strike,seconds_to_close,our_mid,kalshi_yes_mid,snapped_at")
      .order("snapped_at", { ascending: false })
      .limit(30);
    let live: LiveHold = { ticker: null, strike: null, seconds_to_close: null, our_mid: null, kalshi_mid: null, recommendation: null, confidence: null, reason: "No recent snapshots." };
    if (liveSnap && liveSnap.length) {
      const latestTicker = (liveSnap[0] as any).ticker;
      const bucket = (liveSnap as any[]).filter(r => r.ticker === latestTicker);
      const ourVals = bucket.map(r => Number(r.our_mid)).filter(Number.isFinite);
      const kalVals = bucket.map(r => Number(r.kalshi_yes_mid)).filter(Number.isFinite);
      const our = ourVals.length ? ourVals.reduce((s, v) => s + v, 0) / ourVals.length : null;
      const kal = kalVals.length ? kalVals.reduce((s, v) => s + v, 0) / kalVals.length : null;
      const stc = Number((bucket[0] as any).seconds_to_close);
      let rec: LiveHold["recommendation"] = "WAIT";
      let reason = "Ours near coin-flip";
      let conf: number | null = null;
      if (our != null) {
        conf = Math.abs(our - 0.5) * 2;
        const agreeSide = kal != null && ((our > 0.5) === (kal > 0.5));
        if (Math.abs(our - 0.5) < 0.04) {
          rec = "WAIT"; reason = `Ours ${(our * 100).toFixed(0)}% — chop band`;
        } else if (conf >= 0.30 && agreeSide) {
          rec = our > 0.5 ? "HOLD UP" : "HOLD DOWN";
          reason = `Ours ${(our * 100).toFixed(0)}% / Kalshi ${kal != null ? (kal * 100).toFixed(0) : "—"}% agree`;
        } else if (conf >= 0.45) {
          rec = our > 0.5 ? "HOLD UP" : "HOLD DOWN";
          reason = `Ours ${(our * 100).toFixed(0)}% strong (Kalshi disagrees)`;
        } else {
          rec = "WAIT";
          reason = `Ours ${(our * 100).toFixed(0)}% — low conviction`;
        }
      }
      live = {
        ticker: latestTicker,
        strike: Number((bucket[0] as any).strike),
        seconds_to_close: Number.isFinite(stc) ? stc : null,
        our_mid: our,
        kalshi_mid: kal,
        recommendation: rec,
        confidence: conf,
        reason,
      };
    }

    return { rows, summary, live };
  });

