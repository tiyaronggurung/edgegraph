// Turn 4A ops: settlement matcher + collection-health reader.
// Read paths open to any signed-in user (views are RLS-invoker on base tables).
// Write path (matcher) requires admin.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Match settlements: flip pending → matched | missing | ambiguous for windows that have closed. */
export const matchPendingSettlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { graceMinutes?: number; maxRows?: number } | undefined) => ({
    graceMinutes: Math.max(1, Math.min(240, input?.graceMinutes ?? 5)),
    maxRows: Math.max(1, Math.min(10000, input?.maxRows ?? 2000)),
  }))
  .handler(async ({ data, context }) => {
    // Admin check.
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.is_admin) {
      return { ok: false as const, reason: "forbidden", matched: 0, missing: 0, ambiguous: 0, scanned: 0 };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read pending rows whose window closed at least graceMinutes ago.
    const cutoff = new Date(Date.now() - data.graceMinutes * 60_000).toISOString();
    const { data: pending, error: readErr } = await supabaseAdmin
      .from("btc_market_intel")
      // @ts-expect-error: new columns not in generated types yet
      .select("id, ticker, close_time")
      // @ts-expect-error: new column filter
      .eq("settlement_link_status", "pending")
      // @ts-expect-error: new column filter
      .lt("window_close_ts", cutoff)
      .limit(data.maxRows);
    if (readErr) return { ok: false as const, reason: readErr.message, matched: 0, missing: 0, ambiguous: 0, scanned: 0 };

    const rows = (pending ?? []) as Array<{ id: string; ticker: string; close_time: string }>;
    let matched = 0, missing = 0, ambiguous = 0;

    // Group by (ticker, close_time) to run one settlement query per window.
    const groups = new Map<string, { key: { ticker: string; close_time: string }; ids: string[] }>();
    for (const r of rows) {
      const k = `${r.ticker}||${r.close_time}`;
      const g = groups.get(k) ?? { key: { ticker: r.ticker, close_time: r.close_time }, ids: [] };
      g.ids.push(r.id);
      groups.set(k, g);
    }

    // Settlement grace: if window closed > 6h ago and no settlement row exists, mark missing.
    const missingCutoff = new Date(Date.now() - 6 * 60 * 60_000).toISOString();

    for (const g of groups.values()) {
      const { data: preds } = await supabaseAdmin
        .from("btc_model_predictions")
        .select("outcome, was_correct, settled_at")
        .eq("ticker", g.key.ticker)
        .eq("close_time", g.key.close_time)
        .not("settled_at", "is", null);

      const settled = (preds ?? []) as Array<{ outcome: string | null; was_correct: boolean | null }>;
      let nextStatus: "matched" | "missing" | "ambiguous" | null = null;

      if (settled.length === 0) {
        if (g.key.close_time < missingCutoff) nextStatus = "missing";
      } else {
        const outcomes = new Set(settled.map(s => s.outcome).filter(Boolean));
        nextStatus = outcomes.size <= 1 ? "matched" : "ambiguous";
      }
      if (!nextStatus) continue;

      const { error: upErr } = await supabaseAdmin
        .from("btc_market_intel")
        // @ts-expect-error: new column update
        .update({ settlement_link_status: nextStatus })
        .in("id", g.ids);
      if (upErr) continue;

      if (nextStatus === "matched") matched += g.ids.length;
      else if (nextStatus === "missing") missing += g.ids.length;
      else ambiguous += g.ids.length;
    }

    return { ok: true as const, scanned: rows.length, matched, missing, ambiguous };
  });

export interface MarketIntelHealth {
  as_of: string | null;
  total_snapshots: number;
  unique_tickers: number;
  unique_settled_tickers: number;
  pending_rows: number;
  matched_rows: number;
  ok_rows: number;
  partial_rows: number;
  insufficient_rows: number;
  error_rows: number;
  missing_1m_rows: number;
  missing_5m_rows: number;
  missing_15m_rows: number;
  matched_pct: number;
  partial_pct: number;
  insufficient_pct: number;
  error_pct: number;
  missing_1m_pct: number;
  missing_5m_pct: number;
  missing_15m_pct: number;
  avg_calc_ms: number | null;
  p95_calc_ms: number | null;
  avg_input_lag_ms: number | null;
  p95_input_lag_ms: number | null;
  rows_per_hour: number | null;
  avg_snapshots_per_ticker: number | null;
  median_snapshots_per_ticker: number | null;
  direction_distribution: Record<string, number> | null;
  confidence_distribution: Record<string, number> | null;
  market_state_distribution: Record<string, number> | null;
  sequence_state_distribution: Record<string, number> | null;
  volatility_regime_distribution: Record<string, number> | null;
  psych_level_role_distribution: Record<string, number> | null;
  status_distribution: Record<string, number> | null;
  alerts: Record<string, boolean>;
  days_to_500_windows: number | null;
  days_to_1000_windows: number | null;
}

/** Read collection-health view + alert flags. Auth-gated read; needs admin to see. */
export const getMarketIntelHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketIntelHealth | null> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.is_admin) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: health }, { data: alertsRow }, { data: settledCount }] = await Promise.all([
      supabaseAdmin.from("v_market_intel_collection_health" as never).select("*").maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null }>,
      supabaseAdmin.from("v_market_intel_alerts" as never).select("*").maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null }>,
      // Rate at which unique settled windows accumulate (last 24h).
      supabaseAdmin.rpc("count_settled_windows_24h" as never).then(
        () => ({ data: null as number | null }),
        () => ({ data: null as number | null }),
      ),
    ]);

    if (!health) return null;

    // Days-to-N projection based on unique settled tickers per 24h (rough).
    // Fallback: use rows_per_hour × (1 window/hour cadence at 4 markets/hour) if settled count is null.
    const rowsPerHour = Number(health.rows_per_hour ?? 0);
    // Assume ~4 markets per hour → ~4 unique windows per hour on the pipeline side.
    // Actual settled windows/day = min(4×24, unique_settled_tickers current). Use current count as anchor.
    const uniqueSettled = Number(health.unique_settled_tickers ?? 0);
    // Very rough: if we have some settled, extrapolate; else use pipeline cadence assumption.
    const settledPerDay = Math.max(uniqueSettled / 7, rowsPerHour > 0 ? Math.min(96, rowsPerHour * 24 / 40) : 0);
    const daysTo = (target: number) => (settledPerDay > 0 ? Math.max(0, (target - uniqueSettled) / settledPerDay) : null);

    const alertKeys = [
      "alert_settlement_match_low",
      "alert_error_rate_high",
      "alert_insufficient_high",
      "alert_missing_5m_high",
      "alert_input_lag_high",
      "alert_direction_skewed",
      "alert_cadence_high",
    ] as const;
    const alerts: Record<string, boolean> = {};
    for (const k of alertKeys) alerts[k] = Boolean(alertsRow?.[k]);
    void settledCount;

    return {
      as_of: (health.as_of as string) ?? null,
      total_snapshots: Number(health.total_snapshots ?? 0),
      unique_tickers: Number(health.unique_tickers ?? 0),
      unique_settled_tickers: uniqueSettled,
      pending_rows: Number(health.pending_rows ?? 0),
      matched_rows: Number(health.matched_rows ?? 0),
      ok_rows: Number(health.ok_rows ?? 0),
      partial_rows: Number(health.partial_rows ?? 0),
      insufficient_rows: Number(health.insufficient_rows ?? 0),
      error_rows: Number(health.error_rows ?? 0),
      missing_1m_rows: Number(health.missing_1m_rows ?? 0),
      missing_5m_rows: Number(health.missing_5m_rows ?? 0),
      missing_15m_rows: Number(health.missing_15m_rows ?? 0),
      matched_pct: Number(health.matched_pct ?? 0),
      partial_pct: Number(health.partial_pct ?? 0),
      insufficient_pct: Number(health.insufficient_pct ?? 0),
      error_pct: Number(health.error_pct ?? 0),
      missing_1m_pct: Number(health.missing_1m_pct ?? 0),
      missing_5m_pct: Number(health.missing_5m_pct ?? 0),
      missing_15m_pct: Number(health.missing_15m_pct ?? 0),
      avg_calc_ms: health.avg_calc_ms == null ? null : Number(health.avg_calc_ms),
      p95_calc_ms: health.p95_calc_ms == null ? null : Number(health.p95_calc_ms),
      avg_input_lag_ms: health.avg_input_lag_ms == null ? null : Number(health.avg_input_lag_ms),
      p95_input_lag_ms: health.p95_input_lag_ms == null ? null : Number(health.p95_input_lag_ms),
      rows_per_hour: rowsPerHour,
      avg_snapshots_per_ticker: health.avg_snapshots_per_ticker == null ? null : Number(health.avg_snapshots_per_ticker),
      median_snapshots_per_ticker: health.median_snapshots_per_ticker == null ? null : Number(health.median_snapshots_per_ticker),
      direction_distribution: (health.direction_distribution as Record<string, number>) ?? null,
      confidence_distribution: (health.confidence_distribution as Record<string, number>) ?? null,
      market_state_distribution: (health.market_state_distribution as Record<string, number>) ?? null,
      sequence_state_distribution: (health.sequence_state_distribution as Record<string, number>) ?? null,
      volatility_regime_distribution: (health.volatility_regime_distribution as Record<string, number>) ?? null,
      psych_level_role_distribution: (health.psych_level_role_distribution as Record<string, number>) ?? null,
      status_distribution: (health.status_distribution as Record<string, number>) ?? null,
      alerts,
      days_to_500_windows: daysTo(500),
      days_to_1000_windows: daysTo(1000),
    };
  });
