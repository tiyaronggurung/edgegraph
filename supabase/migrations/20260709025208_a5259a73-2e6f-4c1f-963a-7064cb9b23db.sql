CREATE TABLE public.manual_kalshi_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kalshi_order_id TEXT,
  kalshi_trade_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  event_ticker TEXT,
  side TEXT NOT NULL,
  action TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  contracts INTEGER NOT NULL,
  cost_usd NUMERIC,
  filled_at TIMESTAMPTZ NOT NULL,
  settled BOOLEAN NOT NULL DEFAULT false,
  settle_price INTEGER,
  pnl_usd NUMERIC,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kalshi_trade_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_kalshi_trades TO authenticated;
GRANT ALL ON public.manual_kalshi_trades TO service_role;

ALTER TABLE public.manual_kalshi_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own manual trades"
  ON public.manual_kalshi_trades FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own manual trades"
  ON public.manual_kalshi_trades FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own manual trades"
  ON public.manual_kalshi_trades FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own manual trades"
  ON public.manual_kalshi_trades FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_manual_kalshi_trades_user_filled ON public.manual_kalshi_trades (user_id, filled_at DESC);

CREATE TRIGGER update_manual_kalshi_trades_updated_at
  BEFORE UPDATE ON public.manual_kalshi_trades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();