CREATE TABLE public.btc_window_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker text NOT NULL,
  close_time timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  seconds_to_close integer NOT NULL,
  strike_usd numeric,
  spot_usd numeric,
  cushion_usd numeric,
  yes_bid_cents integer,
  yes_ask_cents integer,
  no_bid_cents integer,
  no_ask_cents integer,
  volume integer,
  open_interest integer,
  trendline_buy numeric,
  trendline_mid numeric,
  trendline_sell numeric,
  trendline_position text,
  model_side text,
  model_confidence numeric,
  study_side text,
  study_confidence numeric,
  study_locked boolean NOT NULL DEFAULT false,
  outcome text,
  source text NOT NULL DEFAULT 'cron_30s',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.btc_window_snapshots TO authenticated;
GRANT ALL ON public.btc_window_snapshots TO service_role;

ALTER TABLE public.btc_window_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read window snapshots"
  ON public.btc_window_snapshots FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_btc_window_snapshots_ticker_time
  ON public.btc_window_snapshots (ticker, captured_at DESC);
CREATE INDEX idx_btc_window_snapshots_captured_at
  ON public.btc_window_snapshots (captured_at DESC);
CREATE INDEX idx_btc_window_snapshots_close_time
  ON public.btc_window_snapshots (close_time DESC);