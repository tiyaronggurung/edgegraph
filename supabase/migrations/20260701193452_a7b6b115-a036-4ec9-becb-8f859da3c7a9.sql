
ALTER TABLE public.crypto_trades
  ADD COLUMN IF NOT EXISTS inputs_snapshot jsonb;

CREATE TABLE IF NOT EXISTS public.crypto_trade_misses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES public.crypto_trades(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  predicted_dir text NOT NULL CHECK (predicted_dir IN ('UP','DOWN')),
  actual_dir text NOT NULL CHECK (actual_dir IN ('UP','DOWN','FLAT')),
  spot_at_entry numeric,
  settle_price numeric,
  strike numeric,
  pnl_usd numeric,
  reason_tags text[] NOT NULL DEFAULT '{}',
  diagnosed_reason text NOT NULL,
  inputs_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_id)
);

CREATE INDEX IF NOT EXISTS crypto_trade_misses_user_created_idx
  ON public.crypto_trade_misses (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_trade_misses TO authenticated;
GRANT ALL ON public.crypto_trade_misses TO service_role;

ALTER TABLE public.crypto_trade_misses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own crypto trade misses"
  ON public.crypto_trade_misses
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
