CREATE TABLE public.big_flip_signals (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  spot NUMERIC NOT NULL,
  prev_yes INTEGER NOT NULL,
  new_yes INTEGER NOT NULL,
  prev_no INTEGER NOT NULL,
  new_no INTEGER NOT NULL,
  yes_delta INTEGER NOT NULL,
  to_side TEXT NOT NULL CHECK (to_side IN ('YES','NO')),
  seconds_to_close INTEGER NOT NULL,
  passed_rules BOOLEAN NOT NULL,
  reject_reason TEXT,
  flip_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX big_flip_signals_dedup_idx ON public.big_flip_signals (user_id, ticker, flip_at);
CREATE INDEX big_flip_signals_user_idx ON public.big_flip_signals (user_id, detected_at DESC);

GRANT SELECT, INSERT ON public.big_flip_signals TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.big_flip_signals_id_seq TO authenticated;
GRANT ALL ON public.big_flip_signals TO service_role;
GRANT ALL ON SEQUENCE public.big_flip_signals_id_seq TO service_role;

ALTER TABLE public.big_flip_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own big flip signals" ON public.big_flip_signals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own big flip signals" ON public.big_flip_signals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);