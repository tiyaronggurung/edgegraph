ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS raw_streak_at_fire smallint,
  ADD COLUMN IF NOT EXISTS streak3_would_skip boolean;