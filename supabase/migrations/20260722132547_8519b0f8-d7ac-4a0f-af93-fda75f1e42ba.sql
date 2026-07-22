ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS ta_score double precision,
  ADD COLUMN IF NOT EXISTS ta_reasons jsonb,
  ADD COLUMN IF NOT EXISTS ta_vwap_dist_pct double precision,
  ADD COLUMN IF NOT EXISTS ta_trend_alignment_score double precision,
  ADD COLUMN IF NOT EXISTS ta_rsi_1m double precision,
  ADD COLUMN IF NOT EXISTS ta_rsi_5m double precision,
  ADD COLUMN IF NOT EXISTS ta_macd_5m_hist double precision,
  ADD COLUMN IF NOT EXISTS ta_bb_5m_pctb double precision,
  ADD COLUMN IF NOT EXISTS ta_vwap_rej_up boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ta_vwap_rej_down boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ta_engine_version text;

CREATE INDEX IF NOT EXISTS idx_btc_pred_ta_score ON public.btc_model_predictions (ta_score);
CREATE INDEX IF NOT EXISTS idx_btc_pred_ta_engine_version ON public.btc_model_predictions (ta_engine_version);