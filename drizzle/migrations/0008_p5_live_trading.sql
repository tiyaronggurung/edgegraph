ALTER TABLE public.p5_settings ADD COLUMN IF NOT EXISTS live_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.p5_live_orders (
  id bigserial PRIMARY KEY,
  window_start timestamptz NOT NULL,
  kind text NOT NULL,
  side text NOT NULL,
  intent text NOT NULL,
  limit_px numeric NOT NULL,
  quantity int NOT NULL,
  order_id text,
  state text NOT NULL DEFAULT 'pending',
  filled_qty numeric NOT NULL DEFAULT 0,
  cost numeric,
  proceeds numeric,
  result text,
  pnl numeric,
  settled boolean NOT NULL DEFAULT false,
  error text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (window_start, kind)
);
GRANT SELECT ON public.p5_live_orders TO authenticated;
GRANT ALL ON public.p5_live_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.p5_live_orders_id_seq TO service_role;
ALTER TABLE public.p5_live_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p5 live orders admin read" ON public.p5_live_orders FOR SELECT TO authenticated USING (public.is_ops_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.p5_set_live(p_on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT is_ops_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE p5_settings SET live_enabled = p_on, updated_at = now() WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION public.p5_set_live(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5_set_live(boolean) TO authenticated;