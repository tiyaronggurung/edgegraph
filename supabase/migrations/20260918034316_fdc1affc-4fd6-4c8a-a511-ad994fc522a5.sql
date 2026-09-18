ALTER TABLE public.btc_flow_lean_log
  ADD COLUMN IF NOT EXISTS buy_quote_usd numeric,
  ADD COLUMN IF NOT EXISTS sell_quote_usd numeric,
  ADD COLUMN IF NOT EXISTS avg_buy_price numeric,
  ADD COLUMN IF NOT EXISTS avg_sell_price numeric;