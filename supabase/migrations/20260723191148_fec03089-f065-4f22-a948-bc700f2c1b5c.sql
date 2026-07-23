ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS model_side_pre_study text,
  ADD COLUMN IF NOT EXISTS study_locked_side text;

-- Backfill: existing `side` was already the first-snapshot raw model pick.
UPDATE public.btc_model_predictions
SET model_side_pre_study = side
WHERE model_side_pre_study IS NULL;