// Kalshi book ledger reporting: how much the book collected vs paid out,
// per 15m window and rolled up per hour / day / week.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface BookWindowRow {
  ticker: string;
  window_start: string;
  yes_vol: number | null;
  no_vol: number | null;
  yes_avg_cents: number | null;
  no_avg_cents: number | null;
  total_collected: number | null;
  house_if_yes: number | null;
  house_if_no: number | null;
  house_lean: string | null;
  outcome: string | null;
  house_pnl: number | null;
}

export interface BookBucketRow {
  bucket: string;
  windows: number;
  contracts: number;
  collected: number;
  paid_out: number;
  house_pnl: number;
  book_win_rate: number | null; // % of settled windows where the book profited
}

export interface KalshiBookReport {
  days: number;
  recent: BookWindowRow[];
  perHour: BookBucketRow[];
  perDay: BookBucketRow[];
  perWeek: BookBucketRow[];
  totals: BookBucketRow;
}

function bucketize(rows: BookWindowRow[], keyFn: (d: Date) => string): BookBucketRow[] {
  const map = new Map<string, BookBucketRow>();
  for (const r of rows) {
    const k = keyFn(new Date(r.window_start));
    const b = map.get(k) ?? {
      bucket: k, windows: 0, contracts: 0, collected: 0, paid_out: 0,
      house_pnl: 0, book_win_rate: null,
    };
    b.windows += 1;
    b.contracts += (Number(r.yes_vol) || 0) + (Number(r.no_vol) || 0);
    b.collected += Number(r.total_collected) || 0;
    if (r.outcome) {
      const payout = (Number(r.total_collected) || 0) - (Number(r.house_pnl) || 0);
      b.paid_out += payout;
      b.house_pnl += Number(r.house_pnl) || 0;
    }
    map.set(k, b);
  }
  const settledBy = new Map<string, { n: number; wins: number }>();
  for (const r of rows) {
    if (!r.outcome) continue;
    const k = keyFn(new Date(r.window_start));
    const s = settledBy.get(k) ?? { n: 0, wins: 0 };
    s.n += 1;
    if ((Number(r.house_pnl) || 0) > 0) s.wins += 1;
    settledBy.set(k, s);
  }
  return [...map.values()]
    .map((b) => {
      const s = settledBy.get(b.bucket);
      return {
        ...b,
        contracts: Math.round(b.contracts),
        collected: Math.round(b.collected * 100) / 100,
        paid_out: Math.round(b.paid_out * 100) / 100,
        house_pnl: Math.round(b.house_pnl * 100) / 100,
        book_win_rate: s && s.n > 0 ? Math.round((s.wins / s.n) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => (a.bucket < b.bucket ? 1 : -1));
}

const iso = (d: Date) => d.toISOString();

export const getKalshiBookReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) =>
    z.object({ days: z.number().int().min(1).max(60).default(7) }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<KalshiBookReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("kalshi_book_ledger")
      .select(
        "ticker, window_start, yes_vol, no_vol, yes_avg_cents, no_avg_cents, total_collected, house_if_yes, house_if_no, house_lean, outcome, house_pnl",
      )
      .gte("window_start", since)
      .order("window_start", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const all = (rows ?? []) as BookWindowRow[];

    const perHour = bucketize(all, (d) => iso(d).slice(0, 13) + ":00Z");
    const perDay = bucketize(all, (d) => iso(d).slice(0, 10));
    const perWeek = bucketize(all, (d) => {
      const w = new Date(d);
      w.setUTCHours(0, 0, 0, 0);
      w.setUTCDate(w.getUTCDate() - w.getUTCDay());
      return "wk " + iso(w).slice(0, 10);
    });
    const totals = bucketize(all, () => `last ${data.days}d`)[0] ?? {
      bucket: `last ${data.days}d`, windows: 0, contracts: 0, collected: 0,
      paid_out: 0, house_pnl: 0, book_win_rate: null,
    };

    return {
      days: data.days,
      recent: all.slice(0, 32),
      perHour: perHour.slice(0, 24),
      perDay: perDay.slice(0, 14),
      perWeek: perWeek.slice(0, 6),
      totals,
    };
  });
