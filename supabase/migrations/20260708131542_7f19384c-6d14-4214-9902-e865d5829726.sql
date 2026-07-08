CREATE TABLE public.polymarket_btc_tape (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  snapped_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  up_prob numeric NOT NULL,
  down_prob numeric NOT NULL,
  slug text NOT NULL,
  kalshi_ticker text,
  kalshi_side text,
  kalshi_our_side_cents integer,
  agrees boolean
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polymarket_btc_tape TO authenticated;
GRANT ALL ON public.polymarket_btc_tape TO service_role;
ALTER TABLE public.polymarket_btc_tape ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own polymarket tape"
  ON public.polymarket_btc_tape FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX polymarket_btc_tape_user_snapped_idx
  ON public.polymarket_btc_tape (user_id, snapped_at DESC);