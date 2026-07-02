
CREATE TABLE public.auto_odds_study_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  window_start_at TIMESTAMPTZ NOT NULL,
  ticker TEXT NOT NULL,
  seconds_to_close INTEGER,
  spot NUMERIC,
  yes_cents INTEGER,
  no_cents INTEGER,
  yes_american INTEGER,
  no_american INTEGER,
  model_yes_prob NUMERIC,
  kalshi_favorite_side TEXT,
  picked_side TEXT,
  model_side_prob NUMERIC,
  entered BOOLEAN NOT NULL DEFAULT FALSE,
  hedge_fired BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.auto_odds_study_log TO authenticated;
GRANT ALL ON public.auto_odds_study_log TO service_role;

ALTER TABLE public.auto_odds_study_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own study log"
  ON public.auto_odds_study_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX auto_odds_study_log_user_created_idx
  ON public.auto_odds_study_log (user_id, created_at DESC);
