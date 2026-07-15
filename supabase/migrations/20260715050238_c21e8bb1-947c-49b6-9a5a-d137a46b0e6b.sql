-- Turn 3: extend btc_market_intel with sequence state, psychological levels,
-- data-quality tracking, and idempotency constraints. Shadow-only telemetry.

ALTER TABLE public.btc_market_intel
  ADD COLUMN IF NOT EXISTS sequence_state text,
  ADD COLUMN IF NOT EXISTS expansion_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'computed',
  ADD COLUMN IF NOT EXISTS calculation_duration_ms integer,
  ADD COLUMN IF NOT EXISTS input_lag_ms integer,
  ADD COLUMN IF NOT EXISTS decision_ts timestamptz,
  ADD COLUMN IF NOT EXISTS nearest_psych_level numeric,
  ADD COLUMN IF NOT EXISTS psych_level_interval numeric,
  ADD COLUMN IF NOT EXISTS psych_level_role text,
  ADD COLUMN IF NOT EXISTS psych_level_strength numeric,
  ADD COLUMN IF NOT EXISTS psych_distance_usd numeric,
  ADD COLUMN IF NOT EXISTS psych_distance_atr numeric,
  ADD COLUMN IF NOT EXISTS psych_state text,
  ADD COLUMN IF NOT EXISTS round_confluence_score numeric;

-- Idempotency: one row per (prediction_id, version) when we have a prediction_id;
-- otherwise dedupe by (user, ticker, decision_ts, version).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bmi_pred_version
  ON public.btc_market_intel (prediction_id, market_intel_version)
  WHERE prediction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bmi_ticker_decision_version
  ON public.btc_market_intel (user_id, ticker, decision_ts, market_intel_version)
  WHERE prediction_id IS NULL AND decision_ts IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bmi_decision_ts ON public.btc_market_intel(decision_ts DESC);
CREATE INDEX IF NOT EXISTS idx_bmi_status ON public.btc_market_intel(status);