ALTER TABLE public.own_engine_settings
  ADD COLUMN IF NOT EXISTS require_signal_agreement boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verdict_veto boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS blend_study boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS study_weight numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS min_study_conf numeric NOT NULL DEFAULT 0.7;