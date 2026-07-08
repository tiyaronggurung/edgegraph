ALTER TABLE public.auto_odds_settings
  ADD COLUMN IF NOT EXISTS ignore_low_r2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ignore_cents_band boolean NOT NULL DEFAULT false;