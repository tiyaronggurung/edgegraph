CREATE TABLE public.qc_settings (
  id int PRIMARY KEY DEFAULT 1,
  running boolean NOT NULL DEFAULT false,
  leg1_usd numeric NOT NULL DEFAULT 150,
  leg2_usd numeric NOT NULL DEFAULT 150,
  entry_max numeric NOT NULL DEFAULT 0.68,
  pair_max numeric NOT NULL DEFAULT 0.85,
  last_tick_at timestamptz,
  last_error text,
  last_signals jsonb
);
GRANT SELECT ON public.qc_settings TO authenticated;
GRANT ALL ON public.qc_settings TO service_role;
ALTER TABLE public.qc_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qc_settings read" ON public.qc_settings FOR SELECT TO authenticated USING (true);
INSERT INTO public.qc_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.qc_positions (
  id bigserial PRIMARY KEY,
  strategy text NOT NULL,
  window_start timestamptz NOT NULL,
  up_ct numeric NOT NULL DEFAULT 0,
  up_cost numeric NOT NULL DEFAULT 0,
  down_ct numeric NOT NULL DEFAULT 0,
  down_cost numeric NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  settled boolean NOT NULL DEFAULT false,
  result text,
  payout numeric,
  pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (strategy, window_start)
);
GRANT SELECT ON public.qc_positions TO authenticated;
GRANT ALL ON public.qc_positions TO service_role;
GRANT USAGE ON SEQUENCE public.qc_positions_id_seq TO service_role;
ALTER TABLE public.qc_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qc_positions read" ON public.qc_positions FOR SELECT TO authenticated USING (true);

CREATE TABLE public.qc_fills (
  id bigserial PRIMARY KEY,
  strategy text NOT NULL,
  window_start timestamptz NOT NULL,
  side text NOT NULL,
  kind text NOT NULL,
  contracts numeric,
  price numeric,
  amount numeric,
  reason text,
  signals jsonb,
  ms_from_start integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.qc_fills TO authenticated;
GRANT ALL ON public.qc_fills TO service_role;
GRANT USAGE ON SEQUENCE public.qc_fills_id_seq TO service_role;
ALTER TABLE public.qc_fills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qc_fills read" ON public.qc_fills FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.qc_set_running(p_running boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_ops_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE qc_settings SET running = p_running WHERE id = 1;
END $$;