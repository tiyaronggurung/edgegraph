ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS study_auto_live_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS study_auto_live_fired_at timestamptz;