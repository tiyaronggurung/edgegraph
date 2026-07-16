
CREATE TABLE public.btc_gate_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  btc_entry_gate_enabled BOOLEAN NOT NULL DEFAULT true,
  min_side_confidence NUMERIC NOT NULL DEFAULT 0.90 CHECK (min_side_confidence BETWEEN 0 AND 1),
  require_live_side_agreement BOOLEAN NOT NULL DEFAULT false,
  positive_edge_mode TEXT NOT NULL DEFAULT 'shadow' CHECK (positive_edge_mode IN ('off','shadow','enforced')),
  min_calibrated_edge_points NUMERIC NOT NULL DEFAULT 0,
  slippage_buffer_prob NUMERIC NOT NULL DEFAULT 0.01 CHECK (slippage_buffer_prob >= 0),
  log_gate_decisions BOOLEAN NOT NULL DEFAULT true,
  config_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.btc_gate_config TO authenticated;
GRANT ALL ON public.btc_gate_config TO service_role;
ALTER TABLE public.btc_gate_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read btc_gate_config" ON public.btc_gate_config
  FOR SELECT TO authenticated USING (true);
INSERT INTO public.btc_gate_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.btc_gate_decision_log (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_id TEXT,
  decision_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_bucket BIGINT NOT NULL,
  close_time TIMESTAMPTZ,
  seconds_to_close INTEGER,
  source_path TEXT NOT NULL CHECK (source_path IN ('live_market','stored_prediction_fallback','auto_model_bet_tick')),
  locked_side TEXT NOT NULL CHECK (locked_side IN ('YES','NO')),
  live_side TEXT CHECK (live_side IN ('YES','NO')),
  live_side_disagrees BOOLEAN,
  model_prob NUMERIC,
  side_confidence NUMERIC,
  yes_bid NUMERIC, yes_ask NUMERIC, no_bid NUMERIC, no_ask NUMERIC,
  selected_side_ask NUMERIC,
  estimated_fee NUMERIC,
  raw_model_edge NUMERIC,
  fee_adjusted_edge NUMERIC,
  slippage_adjusted_edge NUMERIC,
  calibrated_edge NUMERIC,
  positive_edge_shadow_pass BOOLEAN,
  gate_action TEXT NOT NULL CHECK (gate_action IN ('BET','PASS')),
  side_confidence_passed BOOLEAN,
  live_agreement_passed BOOLEAN,
  positive_edge_passed BOOLEAN,
  primary_reason TEXT,
  all_reasons JSONB,
  side_conf_threshold NUMERIC,
  require_live_agreement BOOLEAN,
  require_positive_edge BOOLEAN,
  positive_edge_mode TEXT,
  config_version INTEGER
);
CREATE UNIQUE INDEX btc_gate_log_idem ON public.btc_gate_decision_log (ticker, source_path, decision_bucket);
CREATE INDEX btc_gate_log_ts ON public.btc_gate_decision_log (decision_ts DESC);
CREATE INDEX btc_gate_log_close ON public.btc_gate_decision_log (close_time);
CREATE INDEX btc_gate_log_action_source ON public.btc_gate_decision_log (source_path, gate_action, decision_ts DESC);

GRANT SELECT ON public.btc_gate_decision_log TO authenticated;
GRANT ALL ON public.btc_gate_decision_log TO service_role;
ALTER TABLE public.btc_gate_decision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read btc_gate_decision_log" ON public.btc_gate_decision_log
  FOR SELECT TO authenticated USING (true);
