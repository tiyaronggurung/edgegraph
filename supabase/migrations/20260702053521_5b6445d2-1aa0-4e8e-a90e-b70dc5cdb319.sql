ALTER TABLE public.auto_odds_settings
  ADD COLUMN IF NOT EXISTS dd_override_date date;