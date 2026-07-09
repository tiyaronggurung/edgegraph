
CREATE TABLE public.btc_polymarket_triple_window (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kalshi_ticker TEXT NOT NULL UNIQUE,
  market_open_ms BIGINT NOT NULL,
  market_close_ms BIGINT NOT NULL,

  -- W1: T-15 → T-10 (in-flight when Kalshi opens)
  w1_open_prob NUMERIC,
  w1_close_prob NUMERIC,
  w1_avg_prob NUMERIC,
  w1_min_prob NUMERIC,
  w1_max_prob NUMERIC,
  w1_samples INT DEFAULT 0,
  w1_trendline_dir TEXT,
  w1_chart_verdict TEXT,
  w1_chart_strength NUMERIC,

  -- W2: T-10 → T-5
  w2_open_prob NUMERIC,
  w2_close_prob NUMERIC,
  w2_avg_prob NUMERIC,
  w2_min_prob NUMERIC,
  w2_max_prob NUMERIC,
  w2_samples INT DEFAULT 0,
  w2_trendline_dir TEXT,
  w2_chart_verdict TEXT,
  w2_chart_strength NUMERIC,

  -- W3: T-5 → T-0 (resolves at Kalshi strike)
  w3_open_prob NUMERIC,
  w3_close_prob NUMERIC,
  w3_avg_prob NUMERIC,
  w3_min_prob NUMERIC,
  w3_max_prob NUMERIC,
  w3_samples INT DEFAULT 0,
  w3_trendline_dir TEXT,
  w3_chart_verdict TEXT,
  w3_chart_strength NUMERIC,

  -- Aggregate signal
  trendline_1m TEXT,
  trendline_5m TEXT,
  combined_dir TEXT,
  combined_conf NUMERIC,
  actual_outcome TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_btc_polymarket_triple_window_ticker ON public.btc_polymarket_triple_window(kalshi_ticker);
CREATE INDEX idx_btc_polymarket_triple_window_close ON public.btc_polymarket_triple_window(market_close_ms DESC);

GRANT SELECT, INSERT, UPDATE ON public.btc_polymarket_triple_window TO authenticated;
GRANT ALL ON public.btc_polymarket_triple_window TO service_role;

ALTER TABLE public.btc_polymarket_triple_window ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read triple window"
  ON public.btc_polymarket_triple_window FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert triple window"
  ON public.btc_polymarket_triple_window FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update triple window"
  ON public.btc_polymarket_triple_window FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_btc_polymarket_triple_window_updated_at
  BEFORE UPDATE ON public.btc_polymarket_triple_window
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
