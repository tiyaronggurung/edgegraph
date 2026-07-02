
-- Server-side Auto-Odds state tables

CREATE TABLE public.auto_odds_settings (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  auto_button_type text,
  consecutive_losses integer NOT NULL DEFAULT 0,
  stopped_reason text,
  last_tick_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_settings TO authenticated;
GRANT ALL ON public.auto_odds_settings TO service_role;

ALTER TABLE public.auto_odds_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own settings select" ON public.auto_odds_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own settings insert" ON public.auto_odds_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings update" ON public.auto_odds_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_auto_odds_settings_updated_at
  BEFORE UPDATE ON public.auto_odds_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.auto_odds_tracked_orders (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.auto_trade_orders(id) ON DELETE CASCADE,
  entry_side text NOT NULL,
  entry_odds integer,
  whipsaw_armed boolean NOT NULL DEFAULT false,
  processed_settle boolean NOT NULL DEFAULT false,
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX auto_odds_tracked_user_idx ON public.auto_odds_tracked_orders (user_id, processed_settle);
CREATE INDEX auto_odds_tracked_order_idx ON public.auto_odds_tracked_orders (order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_tracked_orders TO authenticated;
GRANT ALL ON public.auto_odds_tracked_orders TO service_role;

ALTER TABLE public.auto_odds_tracked_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own tracked select" ON public.auto_odds_tracked_orders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own tracked insert" ON public.auto_odds_tracked_orders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own tracked update" ON public.auto_odds_tracked_orders
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_auto_odds_tracked_updated_at
  BEFORE UPDATE ON public.auto_odds_tracked_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
