
-- Turn 4A: readiness layer for MarketIntel evaluation.
-- Adds window/mapping columns to btc_market_intel + read-only views for
-- collection health, per-window primary snapshots, and evaluation joins.
-- No writes, no cron, no changes to live model/gates/trades.

ALTER TABLE public.btc_market_intel
  ADD COLUMN IF NOT EXISTS market_window_id      text,
  ADD COLUMN IF NOT EXISTS window_open_ts        timestamptz,
  ADD COLUMN IF NOT EXISTS window_close_ts       timestamptz,
  ADD COLUMN IF NOT EXISTS seconds_to_close      integer,
  ADD COLUMN IF NOT EXISTS time_bucket           text,
  ADD COLUMN IF NOT EXISTS settlement_link_status text DEFAULT 'pending';

-- Constrain settlement_link_status to known values (drop-and-recreate for idempotency).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'btc_market_intel_settlement_link_status_chk') THEN
    ALTER TABLE public.btc_market_intel DROP CONSTRAINT btc_market_intel_settlement_link_status_chk;
  END IF;
END $$;
ALTER TABLE public.btc_market_intel
  ADD CONSTRAINT btc_market_intel_settlement_link_status_chk
  CHECK (settlement_link_status IN ('pending','matched','missing','ambiguous','invalid_time','invalid_ticker','invalid_input'));

CREATE INDEX IF NOT EXISTS idx_bmi_market_window_id       ON public.btc_market_intel (market_window_id);
CREATE INDEX IF NOT EXISTS idx_bmi_window_close_ts        ON public.btc_market_intel (window_close_ts);
CREATE INDEX IF NOT EXISTS idx_bmi_settlement_link_status ON public.btc_market_intel (settlement_link_status);
CREATE INDEX IF NOT EXISTS idx_bmi_ticker_time_bucket     ON public.btc_market_intel (ticker, time_bucket);

-- ---------------------------------------------------------------------------
-- View: v_market_intel_eval
-- Joins each snapshot to matching model prediction + realized settlement.
-- Read-only. Owner-scoped (SECURITY INVOKER — RLS on base tables applies).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_market_intel_eval
WITH (security_invoker = true) AS
SELECT
  mi.id                              AS market_intel_id,
  mi.user_id,
  mi.ticker,
  COALESCE(mi.market_window_id, mi.ticker) AS market_window_id,
  mi.window_open_ts,
  mi.window_close_ts,
  mi.decision_ts,
  mi.seconds_to_close,
  mi.time_bucket,
  mi.settlement_link_status,
  mi.status                          AS intel_status,
  mi.direction                       AS intel_direction,
  mi.confidence                      AS intel_confidence,
  mi.market_state,
  mi.sequence_state,
  mi.volatility_regime,
  mi.structure_direction,
  mi.structure_strength,
  mi.psych_level_role,
  mi.psych_level_interval,
  mi.psych_level_strength,
  mi.psych_distance_atr,
  mi.psych_state,
  mi.strike_distance_in_expected_moves,
  mi.calculation_duration_ms,
  mi.input_lag_ms,
  -- Row-number over window ordered by decision_ts (deterministic).
  ROW_NUMBER() OVER (
    PARTITION BY COALESCE(mi.market_window_id, mi.ticker)
    ORDER BY mi.decision_ts ASC, mi.id ASC
  ) AS snapshot_number_in_window,
  (ROW_NUMBER() OVER (
    PARTITION BY COALESCE(mi.market_window_id, mi.ticker)
    ORDER BY mi.decision_ts ASC, mi.id ASC
  ) = 1) AS is_first_snapshot,
  (ROW_NUMBER() OVER (
    PARTITION BY COALESCE(mi.market_window_id, mi.ticker)
    ORDER BY mi.decision_ts DESC, mi.id DESC
  ) = 1) AS is_last_preclose_snapshot,
  -- Settlement side (best-effort; NULL when no matching prediction).
  bmp.side          AS pred_side,
  bmp.strike        AS pred_strike,
  bmp.model_prob    AS pred_model_prob,
  bmp.market_yes_price AS entry_yes_price,
  bmp.settle_price,
  bmp.outcome       AS settle_outcome,
  bmp.was_correct,
  bmp.settled_at
FROM public.btc_market_intel mi
LEFT JOIN LATERAL (
  SELECT p.side, p.strike, p.model_prob, p.market_yes_price,
         p.settle_price, p.outcome, p.was_correct, p.settled_at
  FROM public.btc_model_predictions p
  WHERE p.ticker = mi.ticker
    AND p.close_time = mi.close_time
  ORDER BY p.settled_at DESC NULLS LAST, p.created_at DESC
  LIMIT 1
) bmp ON true;

GRANT SELECT ON public.v_market_intel_eval TO authenticated;
GRANT SELECT ON public.v_market_intel_eval TO service_role;

-- ---------------------------------------------------------------------------
-- View: v_market_intel_window_primary
-- One deterministic snapshot per (market_window_id, time_bucket).
-- Chooses the snapshot with seconds_to_close closest to the bucket center.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_market_intel_window_primary
WITH (security_invoker = true) AS
WITH bucketed AS (
  SELECT
    mi.*,
    COALESCE(mi.market_window_id, mi.ticker) AS mwid_effective,
    CASE mi.time_bucket
      WHEN 'T-15m'   THEN 900
      WHEN 'T-10m'   THEN 600
      WHEN 'T-7m30s' THEN 450
      WHEN 'T-5m'    THEN 300
      WHEN 'T-3m'    THEN 180
      WHEN 'T-2m'    THEN 120
      WHEN 'T-1m'    THEN 60
      WHEN 'T-30s'   THEN 30
      ELSE NULL
    END AS bucket_center_s
  FROM public.btc_market_intel mi
  WHERE mi.time_bucket IS NOT NULL AND mi.seconds_to_close IS NOT NULL
),
ranked AS (
  SELECT
    b.*,
    ROW_NUMBER() OVER (
      PARTITION BY b.mwid_effective, b.time_bucket
      ORDER BY ABS(COALESCE(b.seconds_to_close, 0) - COALESCE(b.bucket_center_s, 0)) ASC,
               b.decision_ts ASC,
               b.id ASC
    ) AS rn
  FROM bucketed b
)
SELECT * FROM ranked WHERE rn = 1;

GRANT SELECT ON public.v_market_intel_window_primary TO authenticated;
GRANT SELECT ON public.v_market_intel_window_primary TO service_role;

-- ---------------------------------------------------------------------------
-- View: v_market_intel_collection_health
-- One-row summary of collection health metrics + distributions in JSONB.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_market_intel_collection_health
WITH (security_invoker = true) AS
WITH base AS (
  SELECT * FROM public.btc_market_intel
  WHERE created_at > (now() - interval '7 days')
),
counts AS (
  SELECT
    count(*)::bigint AS total_snapshots,
    count(DISTINCT ticker)::bigint AS unique_tickers,
    count(DISTINCT ticker) FILTER (WHERE settlement_link_status = 'matched')::bigint AS unique_settled_tickers,
    count(*) FILTER (WHERE settlement_link_status = 'pending')::bigint AS pending_rows,
    count(*) FILTER (WHERE settlement_link_status = 'matched')::bigint AS matched_rows,
    count(*) FILTER (WHERE status = 'ok')::bigint AS ok_rows,
    count(*) FILTER (WHERE status = 'partial_input')::bigint AS partial_rows,
    count(*) FILTER (WHERE status = 'insufficient_data')::bigint AS insufficient_rows,
    count(*) FILTER (WHERE status = 'error')::bigint AS error_rows,
    count(*) FILTER (WHERE (signals_jsonb->'data_quality'->>'missing_1m')::boolean IS TRUE)::bigint AS missing_1m_rows,
    count(*) FILTER (WHERE (signals_jsonb->'data_quality'->>'missing_5m')::boolean IS TRUE)::bigint AS missing_5m_rows,
    count(*) FILTER (WHERE (signals_jsonb->'data_quality'->>'missing_15m')::boolean IS TRUE)::bigint AS missing_15m_rows,
    avg(calculation_duration_ms)::numeric AS avg_calc_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY calculation_duration_ms)::numeric AS p95_calc_ms,
    avg(input_lag_ms)::numeric AS avg_input_lag_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY input_lag_ms)::numeric AS p95_input_lag_ms,
    (count(*)::numeric
      / GREATEST(EXTRACT(EPOCH FROM (max(created_at) - min(created_at))) / 3600.0, 1)::numeric
    ) AS rows_per_hour
  FROM base
),
per_ticker AS (
  SELECT ticker, count(*)::bigint AS n FROM base GROUP BY ticker
),
per_ticker_stats AS (
  SELECT
    avg(n)::numeric AS avg_snapshots_per_ticker,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::numeric AS median_snapshots_per_ticker
  FROM per_ticker
),
dist_direction AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT COALESCE(direction,'null') AS k, count(*)::bigint AS v FROM base GROUP BY 1
  ) t
),
dist_confidence AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT
      CASE
        WHEN confidence IS NULL THEN 'null'
        WHEN confidence < 0.1 THEN '<0.1'
        WHEN confidence < 0.2 THEN '0.1-0.2'
        WHEN confidence < 0.3 THEN '0.2-0.3'
        WHEN confidence < 0.4 THEN '0.3-0.4'
        WHEN confidence < 0.5 THEN '0.4-0.5'
        WHEN confidence < 0.6 THEN '0.5-0.6'
        WHEN confidence < 0.7 THEN '0.6-0.7'
        WHEN confidence < 0.8 THEN '0.7-0.8'
        WHEN confidence < 0.9 THEN '0.8-0.9'
        ELSE '>=0.9'
      END AS k,
      count(*)::bigint AS v
    FROM base GROUP BY 1
  ) t
),
dist_market_state AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT COALESCE(market_state,'null') AS k, count(*)::bigint AS v FROM base GROUP BY 1
  ) t
),
dist_sequence_state AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT COALESCE(sequence_state,'null') AS k, count(*)::bigint AS v FROM base GROUP BY 1
  ) t
),
dist_vol AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT COALESCE(volatility_regime,'null') AS k, count(*)::bigint AS v FROM base GROUP BY 1
  ) t
),
dist_psych AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT COALESCE(psych_level_role,'null') AS k, count(*)::bigint AS v FROM base GROUP BY 1
  ) t
),
dist_status AS (
  SELECT jsonb_object_agg(k, v) AS d FROM (
    SELECT COALESCE(status,'null') AS k, count(*)::bigint AS v FROM base GROUP BY 1
  ) t
)
SELECT
  now() AS as_of,
  c.total_snapshots,
  c.unique_tickers,
  c.unique_settled_tickers,
  c.pending_rows,
  c.matched_rows,
  c.ok_rows,
  c.partial_rows,
  c.insufficient_rows,
  c.error_rows,
  c.missing_1m_rows,
  c.missing_5m_rows,
  c.missing_15m_rows,
  CASE WHEN c.total_snapshots > 0 THEN c.matched_rows::numeric / c.total_snapshots ELSE 0 END AS matched_pct,
  CASE WHEN c.total_snapshots > 0 THEN c.partial_rows::numeric / c.total_snapshots ELSE 0 END AS partial_pct,
  CASE WHEN c.total_snapshots > 0 THEN c.insufficient_rows::numeric / c.total_snapshots ELSE 0 END AS insufficient_pct,
  CASE WHEN c.total_snapshots > 0 THEN c.error_rows::numeric / c.total_snapshots ELSE 0 END AS error_pct,
  CASE WHEN c.total_snapshots > 0 THEN c.missing_1m_rows::numeric / c.total_snapshots ELSE 0 END AS missing_1m_pct,
  CASE WHEN c.total_snapshots > 0 THEN c.missing_5m_rows::numeric / c.total_snapshots ELSE 0 END AS missing_5m_pct,
  CASE WHEN c.total_snapshots > 0 THEN c.missing_15m_rows::numeric / c.total_snapshots ELSE 0 END AS missing_15m_pct,
  c.avg_calc_ms,
  c.p95_calc_ms,
  c.avg_input_lag_ms,
  c.p95_input_lag_ms,
  c.rows_per_hour,
  pts.avg_snapshots_per_ticker,
  pts.median_snapshots_per_ticker,
  dd.d  AS direction_distribution,
  dc.d  AS confidence_distribution,
  dm.d  AS market_state_distribution,
  ds.d  AS sequence_state_distribution,
  dv.d  AS volatility_regime_distribution,
  dp.d  AS psych_level_role_distribution,
  dst.d AS status_distribution
FROM counts c
CROSS JOIN per_ticker_stats pts
CROSS JOIN dist_direction dd
CROSS JOIN dist_confidence dc
CROSS JOIN dist_market_state dm
CROSS JOIN dist_sequence_state ds
CROSS JOIN dist_vol dv
CROSS JOIN dist_psych dp
CROSS JOIN dist_status dst;

GRANT SELECT ON public.v_market_intel_collection_health TO authenticated;
GRANT SELECT ON public.v_market_intel_collection_health TO service_role;

-- ---------------------------------------------------------------------------
-- View: v_market_intel_alerts
-- Configurable-threshold health flags (observational).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_market_intel_alerts
WITH (security_invoker = true) AS
WITH h AS (SELECT * FROM public.v_market_intel_collection_health),
dom_direction AS (
  SELECT max(v::numeric) AS max_share, sum(v::numeric) AS total
  FROM (SELECT (jsonb_each_text(direction_distribution)).value::numeric AS v FROM h) x
)
SELECT
  h.as_of,
  h.total_snapshots,
  (h.matched_pct < 0.98)          AS alert_settlement_match_low,
  (h.error_pct  > 0.01)           AS alert_error_rate_high,
  (h.insufficient_pct > 0.10)     AS alert_insufficient_high,
  (h.missing_5m_pct > 0.05)       AS alert_missing_5m_high,
  (h.p95_input_lag_ms > 5000)     AS alert_input_lag_high,
  (COALESCE(dd.max_share / NULLIF(dd.total,0), 0) > 0.80) AS alert_direction_skewed,
  (h.avg_snapshots_per_ticker > 40)  AS alert_cadence_high
FROM h, dom_direction dd;

GRANT SELECT ON public.v_market_intel_alerts TO authenticated;
GRANT SELECT ON public.v_market_intel_alerts TO service_role;
