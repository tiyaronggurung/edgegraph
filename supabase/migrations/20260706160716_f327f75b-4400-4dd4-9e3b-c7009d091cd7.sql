
CREATE TABLE public.auto_odds_decision_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Market context
  ticker TEXT NOT NULL,
  spot NUMERIC,
  seconds_to_close INTEGER,
  time_bucket TEXT,

  -- Direction & prediction
  picked_side TEXT NOT NULL,           -- 'YES' | 'NO'
  kalshi_favorite_side TEXT,
  model_yes_prob NUMERIC,
  model_side_prob NUMERIC,             -- P(win) on picked side per model
  market_side_prob NUMERIC,            -- picked side cents / 100
  entry_price_cents INTEGER,           -- picked-side cents at decision time

  -- EV / edge
  edge NUMERIC,                        -- model_side_prob - market_side_prob
  expected_value NUMERIC,              -- (P_win * net_profit) - (P_loss * stake)
  stake_used NUMERIC,

  -- Confidence subscores (0-100 each, may be null when input unavailable)
  ev_score NUMERIC,
  calibration_score NUMERIC,
  sigma_score NUMERIC,
  momentum_score NUMERIC,
  orderflow_score NUMERIC,
  volregime_score NUMERIC,
  whale_score NUMERIC,
  time_penalty NUMERIC,
  sigma_multiplier NUMERIC,

  -- Final decision layer
  confidence_score NUMERIC,            -- 0-100
  confidence_tier TEXT,                -- 'elite' | 'large' | 'standard' | 'half' | 'pass'
  would_enter BOOLEAN NOT NULL DEFAULT false,
  actual_entered BOOLEAN NOT NULL DEFAULT false,

  -- Linked order for later outcome backfill
  order_id UUID,
  final_outcome TEXT,                  -- 'win' | 'loss' | 'breakeven' | null
  final_pnl_usd NUMERIC,

  note TEXT
);

GRANT SELECT ON public.auto_odds_decision_log TO authenticated;
GRANT ALL ON public.auto_odds_decision_log TO service_role;

ALTER TABLE public.auto_odds_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own decision log"
  ON public.auto_odds_decision_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX auto_odds_decision_log_user_created_idx
  ON public.auto_odds_decision_log (user_id, created_at DESC);

CREATE INDEX auto_odds_decision_log_order_idx
  ON public.auto_odds_decision_log (order_id)
  WHERE order_id IS NOT NULL;
