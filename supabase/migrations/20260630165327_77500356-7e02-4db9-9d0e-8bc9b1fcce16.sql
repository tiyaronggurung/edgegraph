CREATE TABLE public.auto_trade_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  session_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('paper','live')) DEFAULT 'paper',
  ticker TEXT NOT NULL,
  event_ticker TEXT,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  stake_usd NUMERIC NOT NULL,
  limit_cents INTEGER NOT NULL,
  contracts INTEGER NOT NULL,
  strike NUMERIC NOT NULL,
  spot_at_entry NUMERIC NOT NULL,
  model_prob NUMERIC NOT NULL,
  market_yes_price NUMERIC NOT NULL,
  edge_pts NUMERIC NOT NULL,
  sigma_distance NUMERIC NOT NULL,
  gap_in_sigmas NUMERIC NOT NULL,
  seconds_to_close INTEGER NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('placed','filled','rejected','settled_win','settled_loss','error')) DEFAULT 'placed',
  kalshi_order_id TEXT,
  settle_price NUMERIC,
  pnl_usd NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_trade_orders TO authenticated;
GRANT ALL ON public.auto_trade_orders TO service_role;

ALTER TABLE public.auto_trade_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage their own auto-trade orders"
  ON public.auto_trade_orders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX auto_trade_orders_user_session_idx ON public.auto_trade_orders(user_id, session_id, created_at DESC);
CREATE INDEX auto_trade_orders_pending_settle_idx ON public.auto_trade_orders(close_time) WHERE status = 'placed';