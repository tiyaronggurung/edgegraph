CREATE TABLE public.btc_pin_risk_shadow (
  id BIGSERIAL PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ticker TEXT NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  seconds_to_close INTEGER NOT NULL,
  strike NUMERIC NOT NULL,
  locked_side TEXT NOT NULL,
  spot NUMERIC,
  cushion_usd NUMERIC,
  cushion_decay_usd_per_min NUMERIC,
  losing_ask_climb_cents NUMERIC,
  losing_vol_ratio NUMERIC,
  implied_vs_composite_usd NUMERIC,
  ta_score NUMERIC,
  ta_flipped_against BOOLEAN,
  score_cushion INTEGER NOT NULL DEFAULT 0,
  score_ask_climb INTEGER NOT NULL DEFAULT 0,
  score_volume INTEGER NOT NULL DEFAULT 0,
  score_divergence INTEGER NOT NULL DEFAULT 0,
  score_ta INTEGER NOT NULL DEFAULT 0,
  score_total INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  flipped BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.btc_pin_risk_shadow TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.btc_pin_risk_shadow_id_seq TO service_role;
ALTER TABLE public.btc_pin_risk_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.btc_pin_risk_shadow FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_pin_risk_shadow_ticker ON public.btc_pin_risk_shadow(ticker);
CREATE INDEX idx_pin_risk_shadow_observed ON public.btc_pin_risk_shadow(observed_at DESC);