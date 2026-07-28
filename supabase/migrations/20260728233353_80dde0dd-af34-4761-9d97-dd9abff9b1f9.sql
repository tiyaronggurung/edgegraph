CREATE TABLE public.btc_side_ticks (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seconds_to_close INTEGER NOT NULL,
  close_time TIMESTAMPTZ,
  spot NUMERIC,
  strike NUMERIC,
  mid_price NUMERIC,
  buy_price NUMERIC,
  sell_price NUMERIC,
  reco_side TEXT,
  reco_conf_pct NUMERIC,
  mem_score NUMERIC,
  above_strike_ratio_90s NUMERIC,
  source TEXT NOT NULL DEFAULT 'client',
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX btc_side_ticks_ticker_stc_idx ON public.btc_side_ticks (ticker, seconds_to_close);
CREATE INDEX btc_side_ticks_evaluated_at_idx ON public.btc_side_ticks (evaluated_at DESC);

GRANT SELECT, INSERT ON public.btc_side_ticks TO authenticated;
GRANT USAGE ON SEQUENCE public.btc_side_ticks_id_seq TO authenticated;
GRANT ALL ON public.btc_side_ticks TO service_role;
GRANT ALL ON SEQUENCE public.btc_side_ticks_id_seq TO service_role;

ALTER TABLE public.btc_side_ticks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth insert own ticks" ON public.btc_side_ticks
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "auth read all ticks" ON public.btc_side_ticks
  FOR SELECT TO authenticated
  USING (true);