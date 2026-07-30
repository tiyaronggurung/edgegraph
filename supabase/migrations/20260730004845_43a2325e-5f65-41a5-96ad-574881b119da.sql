ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS study_t7_side text,
  ADD COLUMN IF NOT EXISTS study_t7_conf numeric,
  ADD COLUMN IF NOT EXISTS study_t7_at timestamptz,
  ADD COLUMN IF NOT EXISTS study_t7_seconds_to_close integer,
  ADD COLUMN IF NOT EXISTS study_t7_spot numeric,
  ADD COLUMN IF NOT EXISTS study_t7_ratio numeric,
  ADD COLUMN IF NOT EXISTS study_t7_source text;