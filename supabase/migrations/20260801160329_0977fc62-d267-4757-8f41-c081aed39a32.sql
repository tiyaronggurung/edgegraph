ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ops_auto_trade_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.ops_trades
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS kalshi_order_id text,
  ADD COLUMN IF NOT EXISTS contracts integer,
  ADD COLUMN IF NOT EXISTS crypto_trade_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ops_trades_auto_unique_window
  ON public.ops_trades (user_id, ticker)
  WHERE source = 'ops_auto';