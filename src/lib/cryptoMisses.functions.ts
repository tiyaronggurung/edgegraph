// Auto-backtest wrong predictions.
// Walks recently settled crypto_trades with pnl_usd < 0, compares the
// predicted direction (side) against the resolved direction from the
// stored settle raw, and writes a rule-based diagnosis into
// crypto_trade_misses. Idempotent — trade_id is UNIQUE in that table.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MissRow {
  id: string;
  trade_id: string;
  ticker: string;
  predicted_dir: "UP" | "DOWN";
  actual_dir: "UP" | "DOWN" | "FLAT";
  spot_at_entry: number | null;
  settle_price: number | null;
  strike: number | null;
  pnl_usd: number | null;
  reason_tags: string[];
  diagnosed_reason: string;
  inputs_snapshot: unknown;
  created_at: string;
}

function diagnose(trade: {
  side: string | null;
  spot_at_entry: number | null;
  strike: number | null;
  chart_verdict_score: number | null;
  model_prob: number | null;
  edge_pts: number | null;
  inputs_snapshot: Record<string, unknown> | null;
  raw: Record<string, unknown> | null;
}): { predicted: "UP" | "DOWN"; actual: "UP" | "DOWN" | "FLAT"; tags: string[]; reason: string; settlePrice: number | null } {
  const predicted: "UP" | "DOWN" = trade.side === "YES" ? "UP" : "DOWN";
  // For a losing trade we assume the actual direction was the opposite.
  // If settle raw includes a settle_price, we can be more precise.
  let settlePrice: number | null = null;
  const settleRaw = (trade.raw as any)?.settle;
  if (settleRaw && typeof settleRaw.settle_price === "number") settlePrice = settleRaw.settle_price;
  const spot = trade.spot_at_entry;
  let actual: "UP" | "DOWN" | "FLAT";
  if (settlePrice != null && spot != null) {
    const d = settlePrice - spot;
    actual = Math.abs(d) < 5 ? "FLAT" : d > 0 ? "UP" : "DOWN";
  } else {
    actual = predicted === "UP" ? "DOWN" : "UP";
  }

  const tags: string[] = [];
  const snap = (trade.inputs_snapshot ?? {}) as Record<string, any>;

  // Rule 1 — candle momentum forecast disagreed
  const cmForecast = snap.candleForecast as string | undefined;
  const cmGuidance = snap.candleGuidance as string | undefined;
  if (cmForecast === "big_red" && predicted === "UP") tags.push("candle_forecast_big_red_ignored");
  if (cmForecast === "big_green" && predicted === "DOWN") tags.push("candle_forecast_big_green_ignored");
  if (cmGuidance === "sell" && predicted === "UP") tags.push("candle_guidance_sell_ignored");

  // Rule 2 — trendline against us
  const tl = snap.trendline as { bias?: string; slope?: number } | undefined;
  if (tl?.bias === "bearish" && predicted === "UP") tags.push("trendline_bearish_vs_long");
  if (tl?.bias === "bullish" && predicted === "DOWN") tags.push("trendline_bullish_vs_short");

  // Rule 3 — verdict score marginal
  const cv = trade.chart_verdict_score;
  if (cv != null && cv < 55) tags.push(`low_verdict_${Math.round(cv)}`);

  // Rule 4 — thin edge
  if (trade.edge_pts != null && Math.abs(Number(trade.edge_pts)) < 3) tags.push("thin_edge");

  // Rule 5 — regime
  const regime = snap.regime as string | undefined;
  if (regime && regime !== "trending") tags.push(`regime_${regime}`);

  // Rule 6 — round-number magnet (if strike is a round 50/100 and we bet against magnet)
  if (trade.strike != null) {
    const s = Number(trade.strike);
    if (s % 100 === 0 || s % 50 === 0) tags.push("round_strike");
  }

  let reason: string;
  if (tags.length === 0) {
    reason = `Model called ${predicted}, market went ${actual}. No obvious contradicting signal in captured inputs — likely noise or missing signal.`;
  } else {
    reason = `Model called ${predicted}, market went ${actual}. Contradicting signals present: ${tags.join(", ")}.`;
  }
  return { predicted, actual, tags, reason, settlePrice };
}

export const diagnoseRecentMisses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ diagnosed: number }> => {
    const { supabase, userId } = context;
    // Look at recently settled trades with a realized loss that we haven't
    // logged a miss for yet. Cap at 50 per call.
    const { data: trades, error } = await supabase
      .from("crypto_trades")
      .select("id, ticker, side, spot_at_entry, strike, pnl_usd, chart_verdict_score, model_prob, edge_pts, inputs_snapshot, raw")
      .eq("user_id", userId)
      .eq("status", "settled")
      .lt("pnl_usd", 0)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    if (!trades?.length) return { diagnosed: 0 };

    const ids = trades.map(t => t.id);
    const { data: existing } = await supabase
      .from("crypto_trade_misses")
      .select("trade_id")
      .in("trade_id", ids);
    const seen = new Set((existing ?? []).map((r: any) => r.trade_id));

    const toInsert = [];
    for (const t of trades) {
      if (seen.has(t.id)) continue;
      const d = diagnose(t as any);
      toInsert.push({
        user_id: userId,
        trade_id: t.id,
        ticker: t.ticker,
        predicted_dir: d.predicted,
        actual_dir: d.actual,
        spot_at_entry: t.spot_at_entry,
        settle_price: d.settlePrice,
        strike: t.strike,
        pnl_usd: t.pnl_usd,
        reason_tags: d.tags,
        diagnosed_reason: d.reason,
        inputs_snapshot: t.inputs_snapshot ?? null,
      });
    }
    if (!toInsert.length) return { diagnosed: 0 };
    const { error: insErr } = await supabase.from("crypto_trade_misses").insert(toInsert);
    if (insErr) throw new Error(insErr.message);
    return { diagnosed: toInsert.length };
  });

export const listRecentMisses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ misses: MissRow[] }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("crypto_trade_misses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { misses: (data ?? []) as MissRow[] };
  });
