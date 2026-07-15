CREATE TABLE public.btc_market_intel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prediction_id uuid REFERENCES public.btc_model_predictions(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  window_start timestamptz NOT NULL,
  close_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  market_intel_version text NOT NULL,
  direction text NOT NULL,
  confidence numeric NOT NULL,
  market_state text NOT NULL,
  structure_direction text NOT NULL,
  structure_strength numeric NOT NULL,
  continuation_score numeric NOT NULL DEFAULT 0,
  reversal_score numeric NOT NULL DEFAULT 0,
  exhaustion_score numeric NOT NULL DEFAULT 0,
  chop_score numeric NOT NULL DEFAULT 0,
  compression_score numeric NOT NULL DEFAULT 0,
  volatility_regime text NOT NULL,
  expected_move_15m_usd numeric NOT NULL,
  expected_move_15m_pct numeric NOT NULL,
  strike_distance_usd numeric NOT NULL,
  strike_distance_in_expected_moves numeric NOT NULL,
  spot_at_compute numeric NOT NULL,
  strike numeric NOT NULL,
  signals_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text,
  settle_price numeric,
  pnl_usd numeric
);

GRANT SELECT, INSERT, UPDATE ON public.btc_market_intel TO authenticated;
GRANT ALL ON public.btc_market_intel TO service_role;

ALTER TABLE public.btc_market_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own market intel" ON public.btc_market_intel
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own market intel" ON public.btc_market_intel
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own market intel" ON public.btc_market_intel
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_bmi_user_created ON public.btc_market_intel(user_id, created_at DESC);
CREATE INDEX idx_bmi_ticker ON public.btc_market_intel(ticker);
CREATE INDEX idx_bmi_prediction ON public.btc_market_intel(prediction_id);
CREATE INDEX idx_bmi_state_regime ON public.btc_market_intel(market_state, volatility_regime);
CREATE INDEX idx_bmi_version ON public.btc_market_intel(market_intel_version);
CREATE INDEX idx_bmi_window_start ON public.btc_market_intel(window_start DESC);