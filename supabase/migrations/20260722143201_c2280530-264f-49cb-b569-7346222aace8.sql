CREATE TABLE public.btc_multi_tf_decision_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  window_ticker text NOT NULL,
  window_open_at timestamptz NOT NULL,
  window_close_at timestamptz NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  seconds_to_close integer NOT NULL,
  decision_state text NOT NULL,

  -- Core proposal
  proposed_side text,
  side_confidence numeric,
  model_prob numeric,
  ta_score numeric,
  ta_reasons jsonb,

  -- Price / strike
  spot_price numeric,
  strike_price numeric,
  strike_distance_usd numeric,
  strike_distance_atr numeric,
  atr_5m numeric,

  -- Kalshi market
  kalshi_ask numeric,
  kalshi_bid numeric,
  expected_value_after_fees numeric,

  -- Stability tracking
  side_flip_count integer DEFAULT 0,
  side_at_t_minus_5m text,
  side_at_t_minus_3m text,
  side_at_t_minus_2m text,
  side_at_t_minus_1m text,
  side_at_t_minus_30s text,

  -- Multi-timeframe context
  above_session_vwap boolean,
  structure_1m text,
  structure_5m text,
  range_pct_24h numeric,
  range_pct_weekly numeric,
  range_pct_monthly numeric,
  bias_1h text,
  bias_weekly text,
  bias_monthly text,

  -- Nearest S/R
  nearest_support_usd numeric,
  nearest_support_distance numeric,
  nearest_support_touches integer,
  nearest_support_status text,
  nearest_resistance_usd numeric,
  nearest_resistance_distance numeric,
  nearest_resistance_touches integer,
  nearest_resistance_status text,

  -- Conflict / skip
  conflict_reason text,
  eligible_to_fire boolean DEFAULT false,

  -- Hypothetical outcomes (filled at settlement)
  ta_only_side text,
  ta_only_result text,
  multi_tf_side text,
  multi_tf_result text,
  settled_close numeric,
  settled_outcome text,
  mfe_usd numeric,
  mae_usd numeric,

  engine_version text NOT NULL DEFAULT 'multi-tf-v1',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mtf_window ON public.btc_multi_tf_decision_log(window_ticker, snapshot_at DESC);
CREATE INDEX idx_mtf_snapshot ON public.btc_multi_tf_decision_log(snapshot_at DESC);
CREATE INDEX idx_mtf_state ON public.btc_multi_tf_decision_log(decision_state);

GRANT SELECT ON public.btc_multi_tf_decision_log TO authenticated;
GRANT ALL ON public.btc_multi_tf_decision_log TO service_role;

ALTER TABLE public.btc_multi_tf_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_mtf_log" ON public.btc_multi_tf_decision_log
  FOR SELECT TO authenticated USING (true);