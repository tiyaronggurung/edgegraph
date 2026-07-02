
CREATE TABLE public.btc_odds_tape (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  spot NUMERIC NOT NULL,
  yes_cents INTEGER NOT NULL,
  no_cents INTEGER NOT NULL,
  seconds_to_close INTEGER NOT NULL,
  snapped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX btc_odds_tape_user_ticker_idx ON public.btc_odds_tape (user_id, ticker, snapped_at DESC);
CREATE INDEX btc_odds_tape_snapped_at_idx ON public.btc_odds_tape (snapped_at);

GRANT SELECT, INSERT ON public.btc_odds_tape TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.btc_odds_tape_id_seq TO authenticated;
GRANT ALL ON public.btc_odds_tape TO service_role;
GRANT ALL ON SEQUENCE public.btc_odds_tape_id_seq TO service_role;

ALTER TABLE public.btc_odds_tape ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own odds tape"
  ON public.btc_odds_tape FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own odds tape"
  ON public.btc_odds_tape FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
