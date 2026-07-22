ALTER TABLE public.big_flip_signals
  ADD COLUMN IF NOT EXISTS kalshi_trade_id uuid REFERENCES public.crypto_trades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fill_count integer,
  ADD COLUMN IF NOT EXISTS fill_price_cents integer;

CREATE INDEX IF NOT EXISTS big_flip_signals_kalshi_trade_id_idx
  ON public.big_flip_signals(kalshi_trade_id)
  WHERE kalshi_trade_id IS NOT NULL;