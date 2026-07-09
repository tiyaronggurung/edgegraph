ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS live_side text,
  ADD COLUMN IF NOT EXISTS flip_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS chart_verdict text,
  ADD COLUMN IF NOT EXISTS chart_strength double precision;