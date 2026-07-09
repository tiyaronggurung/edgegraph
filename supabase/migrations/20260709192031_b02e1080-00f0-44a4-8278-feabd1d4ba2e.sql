ALTER TABLE public.btc_polymarket_triple_window 
  ADD COLUMN IF NOT EXISTS expiration_value NUMERIC,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_btc_tpw_pending_settle 
  ON public.btc_polymarket_triple_window (market_close_ms) 
  WHERE actual_outcome IS NULL;