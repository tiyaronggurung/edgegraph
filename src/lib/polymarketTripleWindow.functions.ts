// Server fns for the 3-window Polymarket/Binance shadow log.
// Display + shadow-log only — DOES NOT feed model, liveSide, or auto-trader.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WindowStats = z.object({
  open_prob: z.number().nullable(),
  close_prob: z.number().nullable(),
  avg_prob: z.number().nullable(),
  min_prob: z.number().nullable(),
  max_prob: z.number().nullable(),
  samples: z.number(),
  trendline_dir: z.string().nullable(),
  chart_verdict: z.string().nullable(),
  chart_strength: z.number().nullable(),
});

const UpsertInput = z.object({
  ticker: z.string(),
  market_open_ms: z.number(),
  market_close_ms: z.number(),
  w1: WindowStats,
  w2: WindowStats,
  w3: WindowStats,
  trendline_1m: z.string().nullable(),
  trendline_5m: z.string().nullable(),
  combined_dir: z.string().nullable(),
  combined_conf: z.number().nullable(),
  enrichment: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const upsertTripleWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      kalshi_ticker: data.ticker,
      market_open_ms: data.market_open_ms,
      market_close_ms: data.market_close_ms,
      w1_open_prob: data.w1.open_prob, w1_close_prob: data.w1.close_prob,
      w1_avg_prob: data.w1.avg_prob, w1_min_prob: data.w1.min_prob, w1_max_prob: data.w1.max_prob,
      w1_samples: data.w1.samples, w1_trendline_dir: data.w1.trendline_dir,
      w1_chart_verdict: data.w1.chart_verdict, w1_chart_strength: data.w1.chart_strength,
      w2_open_prob: data.w2.open_prob, w2_close_prob: data.w2.close_prob,
      w2_avg_prob: data.w2.avg_prob, w2_min_prob: data.w2.min_prob, w2_max_prob: data.w2.max_prob,
      w2_samples: data.w2.samples, w2_trendline_dir: data.w2.trendline_dir,
      w2_chart_verdict: data.w2.chart_verdict, w2_chart_strength: data.w2.chart_strength,
      w3_open_prob: data.w3.open_prob, w3_close_prob: data.w3.close_prob,
      w3_avg_prob: data.w3.avg_prob, w3_min_prob: data.w3.min_prob, w3_max_prob: data.w3.max_prob,
      w3_samples: data.w3.samples, w3_trendline_dir: data.w3.trendline_dir,
      w3_chart_verdict: data.w3.chart_verdict, w3_chart_strength: data.w3.chart_strength,
      trendline_1m: data.trendline_1m,
      trendline_5m: data.trendline_5m,
      combined_dir: data.combined_dir,
      combined_conf: data.combined_conf,
      enrichment_json: (data.enrichment ?? null) as never,
    };
    const { error } = await context.supabase
      .from("btc_polymarket_triple_window")
      .upsert(row, { onConflict: "kalshi_ticker" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTripleWindows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tickers: z.array(z.string()).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.tickers.length === 0) return { rows: [] as TripleWindowRow[] };
    const { data: rows, error } = await context.supabase
      .from("btc_polymarket_triple_window")
      .select("*")
      .in("kalshi_ticker", data.tickers);
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as TripleWindowRow[] };
  });

export interface TripleWindowRow {
  kalshi_ticker: string;
  market_open_ms: number;
  market_close_ms: number;
  w1_open_prob: number | null; w1_close_prob: number | null; w1_avg_prob: number | null;
  w1_min_prob: number | null; w1_max_prob: number | null; w1_samples: number | null;
  w1_trendline_dir: string | null; w1_chart_verdict: string | null; w1_chart_strength: number | null;
  w2_open_prob: number | null; w2_close_prob: number | null; w2_avg_prob: number | null;
  w2_min_prob: number | null; w2_max_prob: number | null; w2_samples: number | null;
  w2_trendline_dir: string | null; w2_chart_verdict: string | null; w2_chart_strength: number | null;
  w3_open_prob: number | null; w3_close_prob: number | null; w3_avg_prob: number | null;
  w3_min_prob: number | null; w3_max_prob: number | null; w3_samples: number | null;
  w3_trendline_dir: string | null; w3_chart_verdict: string | null; w3_chart_strength: number | null;
  trendline_1m: string | null;
  trendline_5m: string | null;
  combined_dir: string | null;
  combined_conf: number | null;
  actual_outcome: string | null;
  expiration_value: number | null;
  settled_at: string | null;
}

// Fetch Kalshi's authoritative settlement and write it into the shadow row.
// Idempotent — skips write if already settled. Called from client on final
// flush AND from the /api/public/hooks/backfill-triple-window cron.
export const settleTripleWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("btc_polymarket_triple_window")
      .select("actual_outcome")
      .eq("kalshi_ticker", data.ticker)
      .maybeSingle();
    if (!existing) return { ok: false, reason: "no shadow row" };
    if (existing.actual_outcome) return { ok: true, reason: "already settled" };

    const { fetchKalshiSettlement } = await import("./kalshiSettle");
    const s = await fetchKalshiSettlement(data.ticker);
    if (!s || !s.finalized || !s.result) return { ok: false, reason: "not finalized" };

    const { error } = await context.supabase
      .from("btc_polymarket_triple_window")
      .update({
        actual_outcome: s.result.toUpperCase(),
        expiration_value: s.expirationValue,
        settled_at: new Date().toISOString(),
      })
      .eq("kalshi_ticker", data.ticker);
    if (error) throw new Error(error.message);
    return { ok: true, result: s.result, expirationValue: s.expirationValue };
  });
