
CREATE TABLE public.btc_kalshi_odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  snapped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snap_bucket_sec BIGINT NOT NULL,
  seconds_to_close INTEGER,
  kalshi_yes_bid NUMERIC,
  kalshi_yes_ask NUMERIC,
  kalshi_yes_mid NUMERIC,
  kalshi_implied_spot NUMERIC,
  spot_composite NUMERIC,
  our_mid NUMERIC,
  our_up_ask NUMERIC,
  our_down_ask NUMERIC,
  our_sigma NUMERIC,
  our_tilt NUMERIC,
  delta_up NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, snap_bucket_sec)
);

CREATE INDEX btc_kalshi_odds_snapshots_ticker_time_idx
  ON public.btc_kalshi_odds_snapshots (ticker, snapped_at DESC);
CREATE INDEX btc_kalshi_odds_snapshots_snapped_at_idx
  ON public.btc_kalshi_odds_snapshots (snapped_at DESC);

GRANT SELECT, INSERT ON public.btc_kalshi_odds_snapshots TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.btc_kalshi_odds_snapshots_id_seq TO authenticated;
GRANT ALL ON public.btc_kalshi_odds_snapshots TO service_role;
GRANT ALL ON SEQUENCE public.btc_kalshi_odds_snapshots_id_seq TO service_role;

ALTER TABLE public.btc_kalshi_odds_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read odds snapshots"
  ON public.btc_kalshi_odds_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated insert odds snapshots"
  ON public.btc_kalshi_odds_snapshots FOR INSERT
  TO authenticated WITH CHECK (true);
