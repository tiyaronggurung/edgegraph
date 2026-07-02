-- Shadow simulator for auto-trade gates: replays what-if thresholds against
-- settled orders. Also adds inputs_snapshot to auto_trade_orders so future
-- runs can simulate the richer gates (candle, trendline, verdict).

ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS inputs_snapshot jsonb;

CREATE TABLE IF NOT EXISTS public.crypto_gate_shadow_sim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_source text NOT NULL,           -- 'auto_trade' | 'manual'
  gate_name text NOT NULL,              -- e.g. 'sigmaMin', 'edgeMin', 'probMin'
  threshold jsonb NOT NULL,             -- e.g. {"min": 2.0}
  would_have_blocked boolean NOT NULL,
  outcome text NOT NULL,                -- 'win' | 'loss'
  pnl_usd numeric NOT NULL,             -- actual realized pnl of the trade
  pnl_saved numeric NOT NULL,           -- +pnl if blocking a loss, -pnl if blocking a win
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, order_id, order_source, gate_name, threshold)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_gate_shadow_sim TO authenticated;
GRANT ALL ON public.crypto_gate_shadow_sim TO service_role;

ALTER TABLE public.crypto_gate_shadow_sim ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own shadow sim rows"
  ON public.crypto_gate_shadow_sim
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS crypto_gate_shadow_sim_user_gate_idx
  ON public.crypto_gate_shadow_sim (user_id, gate_name);
