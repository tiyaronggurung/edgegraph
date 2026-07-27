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

