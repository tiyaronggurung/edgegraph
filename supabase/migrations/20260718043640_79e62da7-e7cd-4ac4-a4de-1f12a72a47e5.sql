ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS funding_rate_at_fire numeric,
  ADD COLUMN IF NOT EXISTS funding_zscore_30d numeric;