ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS study_lock_confidence numeric,
  ADD COLUMN IF NOT EXISTS study_lock_source text,
  ADD COLUMN IF NOT EXISTS study_lock_seconds_to_close integer,
  ADD COLUMN IF NOT EXISTS study_locked_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'btc_model_predictions_study_lock_source_check'
      AND conrelid = 'public.btc_model_predictions'::regclass
  ) THEN
    ALTER TABLE public.btc_model_predictions
      ADD CONSTRAINT btc_model_predictions_study_lock_source_check
      CHECK (study_lock_source IS NULL OR study_lock_source IN ('trendline_chip', 'server_420', 'manual_correction'));
  END IF;
END $$;

UPDATE public.btc_model_predictions
SET
  study_locked_side = 'YES',
  study_lock_confidence = COALESCE(study_lock_confidence, 75),
  study_lock_source = 'manual_correction',
  study_lock_seconds_to_close = COALESCE(study_lock_seconds_to_close, 480),
  study_locked_at = COALESCE(study_locked_at, updated_at),
  was_correct = CASE WHEN outcome IS NULL THEN was_correct ELSE (outcome = 'YES') END,
  updated_at = now()
WHERE ticker = 'KXBTC15M-26JUL281400-00';