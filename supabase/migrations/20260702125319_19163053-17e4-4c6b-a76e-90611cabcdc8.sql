
ALTER TABLE public.auto_odds_study_log
  ADD COLUMN IF NOT EXISTS prior_yes_cents integer,
  ADD COLUMN IF NOT EXISTS yes_cents_delta integer,
  ADD COLUMN IF NOT EXISTS spot_delta numeric,
  ADD COLUMN IF NOT EXISTS seconds_since_prior integer,
  ADD COLUMN IF NOT EXISTS crossed_50 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_bucket text;

CREATE INDEX IF NOT EXISTS auto_odds_study_log_user_ticker_created_idx
  ON public.auto_odds_study_log (user_id, ticker, created_at DESC);
