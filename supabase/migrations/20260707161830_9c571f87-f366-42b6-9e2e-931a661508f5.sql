
CREATE TABLE public.auto_trade_ta_shadow (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_id UUID,
  ticker TEXT,
  side_evaluated TEXT,

  kalshi_price_cents NUMERIC,
  model_prob NUMERIC,
  edge_pts NUMERIC,

  kalshi_direction TEXT,      -- 'YES' | 'NO' | 'neutral'
  model_direction TEXT,       -- 'YES' | 'NO' | 'neutral'
  ta_direction_1m TEXT,       -- 'YES' | 'NO' | 'neutral'
  ta_direction_5m TEXT,
  ta_direction_combined TEXT,
  ta_confidence NUMERIC,      -- 0..1
  ta_reasons JSONB,           -- string[]

  trend_1m TEXT,              -- 'up' | 'down' | 'flat'
  trend_5m TEXT,
  support_level NUMERIC,
  resistance_level NUMERIC,
  nearest_round_level NUMERIC,
  rejection_wick_flag BOOLEAN DEFAULT FALSE,

  all_three_agree BOOLEAN DEFAULT FALSE,
  two_of_three_agree BOOLEAN DEFAULT FALSE,
  ta_disagrees_kalshi BOOLEAN DEFAULT FALSE,
  ta_disagrees_model BOOLEAN DEFAULT FALSE,

  actual_outcome TEXT,        -- 'win' | 'loss' | null
  actual_pnl_usd NUMERIC,
  full_loss BOOLEAN,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ta_shadow_user_created ON public.auto_trade_ta_shadow (user_id, created_at DESC);
CREATE INDEX idx_ta_shadow_order ON public.auto_trade_ta_shadow (order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_trade_ta_shadow TO authenticated;
GRANT ALL ON public.auto_trade_ta_shadow TO service_role;

ALTER TABLE public.auto_trade_ta_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ta shadow rows"
  ON public.auto_trade_ta_shadow
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_ta_shadow_updated_at
  BEFORE UPDATE ON public.auto_trade_ta_shadow
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
