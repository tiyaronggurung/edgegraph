CREATE TABLE public.auto_trade_skip_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  skip_reason TEXT NOT NULL,
  model_prob NUMERIC,
  ask_price NUMERIC,
  ev_edge NUMERIC,
  sigma_distance NUMERIC,
  seconds_to_close INTEGER,
  strike NUMERIC,
  spot_at_skip NUMERIC,
  close_time TIMESTAMPTZ,
  would_have_won BOOLEAN,
  would_have_pnl NUMERIC,
  settle_price NUMERIC,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_trade_skip_log TO authenticated;
GRANT ALL ON public.auto_trade_skip_log TO service_role;

ALTER TABLE public.auto_trade_skip_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own skip logs"
  ON public.auto_trade_skip_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX auto_trade_skip_log_user_created_idx
  ON public.auto_trade_skip_log (user_id, created_at DESC);

CREATE INDEX auto_trade_skip_log_pending_settle_idx
  ON public.auto_trade_skip_log (close_time)
  WHERE settled_at IS NULL;