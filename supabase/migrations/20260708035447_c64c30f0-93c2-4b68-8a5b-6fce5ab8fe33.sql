
-- Skip-reason log
CREATE TABLE public.auto_trade_odds_skip_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  reason text NOT NULL,
  trigger_candidate text,
  yes_cents integer,
  no_cents integer,
  seconds_to_close integer,
  flip_count integer,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_trade_odds_skip_log TO authenticated;
GRANT ALL ON public.auto_trade_odds_skip_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_trade_odds_skip_log_id_seq TO authenticated, service_role;
ALTER TABLE public.auto_trade_odds_skip_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own skip log" ON public.auto_trade_odds_skip_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own skip log" ON public.auto_trade_odds_skip_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX auto_trade_odds_skip_log_user_created_idx ON public.auto_trade_odds_skip_log(user_id, created_at DESC);

-- Calibration: per-user, per-trigger tuned thresholds
CREATE TABLE public.auto_odds_calibration (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('leader_chase','flip_fade')),
  min_cents integer NOT NULL DEFAULT 60,
  max_cents integer NOT NULL DEFAULT 90,
  min_velocity integer NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  last_tuned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trigger)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_calibration TO authenticated;
GRANT ALL ON public.auto_odds_calibration TO service_role;
ALTER TABLE public.auto_odds_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own calibration" ON public.auto_odds_calibration FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Extra fields on shadow trades
ALTER TABLE public.auto_trade_odds_shadow
  ADD COLUMN IF NOT EXISTS entry_velocity_cents integer,
  ADD COLUMN IF NOT EXISTS early_exited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exit_cents integer,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exited_at timestamptz;
