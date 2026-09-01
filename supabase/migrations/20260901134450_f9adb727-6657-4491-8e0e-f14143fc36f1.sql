CREATE TABLE public.own_engine_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  armed BOOLEAN NOT NULL DEFAULT false,
  paper BOOLEAN NOT NULL DEFAULT true,
  bankroll_cents INTEGER NOT NULL DEFAULT 1000000,
  min_edge_cents INTEGER NOT NULL DEFAULT 8,
  min_price_cents INTEGER NOT NULL DEFAULT 50,
  max_price_cents INTEGER NOT NULL DEFAULT 70,
  late_block_seconds INTEGER NOT NULL DEFAULT 300,
  late_cushion_usd NUMERIC NOT NULL DEFAULT 60,
  max_pair_cost_cents INTEGER NOT NULL DEFAULT 96,
  dominance_block_cents INTEGER NOT NULL DEFAULT 70,
  per_side_window_cap_usd NUMERIC NOT NULL DEFAULT 300,
  per_window_cap_usd NUMERIC NOT NULL DEFAULT 2000,
  risk_per_trade_pct NUMERIC NOT NULL DEFAULT 1,
  stack_fraction NUMERIC NOT NULL DEFAULT 0.5,
  stack_gain_cents INTEGER NOT NULL DEFAULT 9,
  exit_capture_pct INTEGER NOT NULL DEFAULT 92,
  stop_loss_fraction NUMERIC NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.own_engine_settings TO authenticated;
GRANT ALL ON public.own_engine_settings TO service_role;
ALTER TABLE public.own_engine_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_engine_settings_owner" ON public.own_engine_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER own_engine_settings_updated_at BEFORE UPDATE ON public.own_engine_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.own_engine_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  close_time TIMESTAMPTZ,
  strike NUMERIC,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  contracts INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('pair_lock','directional','stack','exit','settlement')),
  model_prob NUMERIC,
  edge_cents NUMERIC,
  z_score NUMERIC,
  cushion_usd NUMERIC,
  spot NUMERIC,
  seconds_left INTEGER,
  paper BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','settled')),
  exit_price_cents INTEGER,
  exit_reason TEXT,
  pnl_cents INTEGER,
  outcome TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX own_engine_orders_user_created_idx ON public.own_engine_orders (user_id, created_at DESC);
CREATE INDEX own_engine_orders_open_idx ON public.own_engine_orders (user_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.own_engine_orders TO authenticated;
GRANT ALL ON public.own_engine_orders TO service_role;
ALTER TABLE public.own_engine_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_engine_orders_owner" ON public.own_engine_orders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.own_engine_skips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  ticker TEXT,
  code TEXT NOT NULL,
  reason TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX own_engine_skips_user_created_idx ON public.own_engine_skips (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.own_engine_skips TO authenticated;
GRANT ALL ON public.own_engine_skips TO service_role;
ALTER TABLE public.own_engine_skips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_engine_skips_owner" ON public.own_engine_skips FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);