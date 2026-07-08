CREATE TABLE public.auto_odds_scalp_shadow (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  strike numeric NOT NULL,
  setup_kind text NOT NULL CHECK (setup_kind IN ('compression','cliff')),
  entry_side text NOT NULL CHECK (entry_side IN ('YES','NO')),
  entry_cents integer NOT NULL,
  entry_spot numeric NOT NULL,
  entry_dist_to_strike numeric NOT NULL,
  seconds_to_close_at_entry integer NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  exit_cents integer,
  exit_reason text CHECK (exit_reason IN ('mean_revert','strike_cross','time_stop','settled')),
  exit_spot numeric,
  exited_at timestamptz,
  pnl_cents integer,
  settled_yes boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auto_odds_scalp_shadow_user_ticker_idx
  ON public.auto_odds_scalp_shadow (user_id, ticker, entered_at DESC);
CREATE INDEX auto_odds_scalp_shadow_open_idx
  ON public.auto_odds_scalp_shadow (user_id, ticker, setup_kind)
  WHERE exited_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_scalp_shadow TO authenticated;
GRANT ALL ON public.auto_odds_scalp_shadow TO service_role;

ALTER TABLE public.auto_odds_scalp_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own scalp shadow"
  ON public.auto_odds_scalp_shadow FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);