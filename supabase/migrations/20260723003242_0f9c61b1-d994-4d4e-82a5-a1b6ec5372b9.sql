CREATE TABLE public.btc_trendline_shadow (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  spot NUMERIC NOT NULL,
  strike NUMERIC,
  seconds_to_close INTEGER,
  upper_slope NUMERIC,
  upper_intercept NUMERIC,
  lower_slope NUMERIC,
  lower_intercept NUMERIC,
  upper_price_now NUMERIC,
  lower_price_now NUMERIC,
  dist_to_upper_pct NUMERIC,
  dist_to_lower_pct NUMERIC,
  channel_width_pct NUMERIC,
  is_wedge BOOLEAN NOT NULL DEFAULT false,
  wedge_bias TEXT,
  spike_detected BOOLEAN NOT NULL DEFAULT false,
  spike_direction TEXT,
  spike_body_ratio NUMERIC,
  spike_break_pct NUMERIC,
  swings_used INTEGER,
  outcome TEXT,
  outcome_settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trendline_shadow_user_time ON public.btc_trendline_shadow (user_id, evaluated_at DESC);
CREATE INDEX idx_trendline_shadow_ticker ON public.btc_trendline_shadow (ticker);
CREATE INDEX idx_trendline_shadow_spike ON public.btc_trendline_shadow (user_id, spike_detected, evaluated_at DESC) WHERE spike_detected = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.btc_trendline_shadow TO authenticated;
GRANT ALL ON public.btc_trendline_shadow TO service_role;

ALTER TABLE public.btc_trendline_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own trendline shadow rows"
  ON public.btc_trendline_shadow
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);