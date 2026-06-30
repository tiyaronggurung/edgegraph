CREATE TABLE public.crypto_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  ticker text NOT NULL,
  event_ticker text,
  side text NOT NULL CHECK (side IN ('YES','NO')),
  strike numeric,
  spot_at_entry numeric,
  model_prob numeric,
  market_yes_price numeric,
  edge_pts numeric,
  contracts integer NOT NULL DEFAULT 0,
  stake_usd numeric NOT NULL DEFAULT 0,
  bankroll_usd numeric,
  kelly_multiplier numeric,
  close_time timestamptz,
  kalshi_order_id text,
  status text NOT NULL DEFAULT 'pending',
  outcome text,
  settled_yes_price numeric,
  pnl_usd numeric,
  error text,
  raw jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_trades TO authenticated;
GRANT ALL ON public.crypto_trades TO service_role;
ALTER TABLE public.crypto_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own crypto trades"
  ON public.crypto_trades FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX crypto_trades_user_created_idx ON public.crypto_trades (user_id, created_at DESC);