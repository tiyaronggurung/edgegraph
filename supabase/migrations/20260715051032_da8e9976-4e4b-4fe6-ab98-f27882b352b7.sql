ALTER TABLE public.btc_market_intel ALTER COLUMN user_id DROP NOT NULL;

-- Additional dedupe path for global (user-less) snapshots.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bmi_global_ticker_decision_version
  ON public.btc_market_intel (ticker, decision_ts, market_intel_version)
  WHERE user_id IS NULL AND prediction_id IS NULL AND decision_ts IS NOT NULL;