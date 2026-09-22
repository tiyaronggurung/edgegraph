CREATE TABLE public.btc_composite_flow_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  seconds_to_close INTEGER,
  spot NUMERIC,
  strike NUMERIC,
  binance_in_btc NUMERIC,
  binance_out_btc NUMERIC,
  binance_avg_in NUMERIC,
  binance_avg_out NUMERIC,
  coinbase_in_btc NUMERIC,
  coinbase_out_btc NUMERIC,
  coinbase_avg_in NUMERIC,
  coinbase_avg_out NUMERIC,
  coinbase_partial BOOLEAN,
  kraken_btc NUMERIC,
  bitstamp_btc NUMERIC,
  total_btc NUMERIC,
  composite_in_btc NUMERIC,
  composite_out_btc NUMERIC,
  composite_net_btc NUMERIC,
  composite_imbalance NUMERIC,
  composite_avg_in NUMERIC,
  composite_avg_out NUMERIC,
  now_vs_avg_in NUMERIC,
  leg_avgs TEXT,
  leg_flow TEXT,
  leg_now_vs_avg TEXT,
  verdict TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_btc_composite_flow_log_window ON public.btc_composite_flow_log (window_start DESC, recorded_at DESC);

GRANT SELECT ON public.btc_composite_flow_log TO authenticated;
GRANT ALL ON public.btc_composite_flow_log TO service_role;

ALTER TABLE public.btc_composite_flow_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read composite flow log"
  ON public.btc_composite_flow_log FOR SELECT TO authenticated USING (true);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verdict_bet_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verdict_bet_live_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verdict_bet_enabled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS verdict_bet_stake_cents INTEGER NOT NULL DEFAULT 1000;