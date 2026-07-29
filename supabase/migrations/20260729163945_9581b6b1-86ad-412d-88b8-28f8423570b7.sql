ALTER TABLE public.btc_gate_config
  ADD COLUMN IF NOT EXISTS cvv_mode TEXT NOT NULL DEFAULT 'enforced',
  ADD COLUMN IF NOT EXISTS cvv_atr_mult NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS cvv_momentum_max_usd NUMERIC NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS cvv_atr_lookback_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS cvv_verdict TEXT,
  ADD COLUMN IF NOT EXISTS cvv_reason TEXT,
  ADD COLUMN IF NOT EXISTS cvv_cushion_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS cvv_atr_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS cvv_momentum_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS cvv_would_lock_side TEXT,
  ADD COLUMN IF NOT EXISTS cvv_would_lock_conf INTEGER;

CREATE INDEX IF NOT EXISTS idx_btc_preds_cvv_verdict
  ON public.btc_model_predictions (cvv_verdict, close_time DESC);