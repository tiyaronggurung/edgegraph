CREATE TABLE public.p5_settings (
  id int PRIMARY KEY DEFAULT 1,
  running boolean NOT NULL DEFAULT false,
  stake numeric NOT NULL DEFAULT 10,
  last_status jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.p5_settings (id) VALUES (1);

CREATE TABLE public.p5_windows (
  window_start timestamptz PRIMARY KEY,
  strike numeric,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  signal_side text,
  signal_odds numeric,
  signal_ask numeric,
  signal_sec int,
  situation text,
  traded boolean NOT NULL DEFAULT false,
  result text,
  close_spot numeric,
  learned boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.p5_positions (
  id bigserial PRIMARY KEY,
  window_start timestamptz NOT NULL UNIQUE,
  side text NOT NULL,
  contracts int NOT NULL,
  entry_px numeric NOT NULL,
  cost numeric NOT NULL,
  situation text,
  hedge_contracts int,
  hedge_px numeric,
  hedge_cost numeric,
  exit_kind text,
  exit_px numeric,
  proceeds numeric,
  result text,
  pnl numeric,
  settled boolean NOT NULL DEFAULT false,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE public.p5_situations (
  key text PRIMARY KEY,
  n int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  px_sum numeric NOT NULL DEFAULT 0,
  pnl_per_dollar_sum numeric NOT NULL DEFAULT 0,
  allowed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.p5_settings, public.p5_windows, public.p5_positions, public.p5_situations TO authenticated;
GRANT ALL ON public.p5_settings, public.p5_windows, public.p5_positions, public.p5_situations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.p5_positions_id_seq TO service_role;

ALTER TABLE public.p5_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p5_situations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p5 settings admin read" ON public.p5_settings FOR SELECT TO authenticated USING (public.is_ops_admin(auth.uid()));
CREATE POLICY "p5 windows admin read" ON public.p5_windows FOR SELECT TO authenticated USING (public.is_ops_admin(auth.uid()));
CREATE POLICY "p5 positions admin read" ON public.p5_positions FOR SELECT TO authenticated USING (public.is_ops_admin(auth.uid()));
CREATE POLICY "p5 situations admin read" ON public.p5_situations FOR SELECT TO authenticated USING (public.is_ops_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.p5_update_settings(p_running boolean, p_stake numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT is_ops_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_stake IS NULL OR p_stake < 1 OR p_stake > 1000 THEN RAISE EXCEPTION 'stake must be 1–1000'; END IF;
  UPDATE p5_settings SET running = p_running, stake = p_stake, updated_at = now() WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION public.p5_update_settings(boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5_update_settings(boolean, numeric) TO authenticated;