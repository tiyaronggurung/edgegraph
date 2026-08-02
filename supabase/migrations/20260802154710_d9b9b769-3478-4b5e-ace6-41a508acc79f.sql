ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS study_auto_stake_cents integer NOT NULL DEFAULT 1000;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_study_auto_stake_cents_range
  CHECK (study_auto_stake_cents >= 100 AND study_auto_stake_cents <= 10000);