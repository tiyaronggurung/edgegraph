-- lovable-cron-fallback-reviewed: hedge bot must react to cheap-odds moments inside 15-min windows; 10s cadence required, same trade-off as the existing paper-bot tick.
CREATE TABLE public.hd_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  running boolean NOT NULL DEFAULT false,
  cash numeric NOT NULL DEFAULT 3000,
  start_cash numeric NOT NULL DEFAULT 3000,
  contracts_per_leg integer NOT NULL DEFAULT 10,
  entry_max numeric NOT NULL DEFAULT 0.45,   -- buy a side when our odds price it at or below this
  hedge_max numeric NOT NULL DEFAULT 0.45,   -- buy the opposite side when it also drops to this
  skip_final_seconds integer NOT NULL DEFAULT 60,
  reset_epoch integer NOT NULL DEFAULT 0,
  last_tick_at timestamptz,
  last_error text,
  last_equity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.hd_settings (id) VALUES (1);

CREATE TABLE public.hd_windows (
  window_start timestamptz PRIMARY KEY,
  up_ct integer NOT NULL DEFAULT 0,
  up_cost numeric NOT NULL DEFAULT 0,
  down_ct integer NOT NULL DEFAULT 0,
  down_cost numeric NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,     -- both legs filled
  settled boolean NOT NULL DEFAULT false,
  result text,                               -- 'UP' | 'DOWN'
  payout numeric NOT NULL DEFAULT 0,
  pnl numeric,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hd_fills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  side text NOT NULL,                        -- 'UP' | 'DOWN'
  kind text NOT NULL,                        -- 'entry' | 'hedge' | 'settle'
  contracts integer NOT NULL DEFAULT 0,
  price numeric,                             -- our odds price 0..1
  amount numeric NOT NULL DEFAULT 0,
  reason text,
  our_p_up numeric,
  spot numeric,
  strike numeric,
  pnl numeric
);

CREATE TABLE public.hd_equity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  equity numeric NOT NULL,
  pnl numeric NOT NULL,
  cash numeric NOT NULL,
  open_value numeric NOT NULL
);

GRANT SELECT ON public.hd_settings, public.hd_windows, public.hd_fills, public.hd_equity TO authenticated;
GRANT ALL ON public.hd_settings, public.hd_windows, public.hd_fills, public.hd_equity TO service_role;

ALTER TABLE public.hd_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hd_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hd_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hd_equity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed-in read hd_settings" ON public.hd_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "signed-in read hd_windows" ON public.hd_windows FOR SELECT TO authenticated USING (true);
CREATE POLICY "signed-in read hd_fills" ON public.hd_fills FOR SELECT TO authenticated USING (true);
CREATE POLICY "signed-in read hd_equity" ON public.hd_equity FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.hd_update_settings(p_running boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_ops_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE hd_settings SET running = p_running WHERE id = 1;
END $$;

CREATE OR REPLACE FUNCTION public.hd_reset(new_budget numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_ops_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  IF new_budget IS NULL OR new_budget <= 0 THEN RAISE EXCEPTION 'budget must be positive'; END IF;
  DELETE FROM hd_fills;
  DELETE FROM hd_windows;
  DELETE FROM hd_equity;
  UPDATE hd_settings
  SET running = false, cash = new_budget, start_cash = new_budget,
      reset_epoch = reset_epoch + 1, last_error = NULL, last_equity_at = NULL
  WHERE id = 1;
END $$;

CREATE OR REPLACE FUNCTION public.hd_equity_range(range_seconds integer DEFAULT 0)
RETURNS TABLE(ts timestamptz, pnl numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (
    SELECT e.ts, e.pnl,
           row_number() OVER (ORDER BY e.ts) AS rn, count(*) OVER () AS n
    FROM hd_equity e
    WHERE range_seconds <= 0 OR e.ts >= (SELECT max(ts) FROM hd_equity) - make_interval(secs => range_seconds)
  )
  SELECT r.ts, r.pnl FROM r
  WHERE rn % greatest(1, n / 1500) = 0 OR rn = n OR rn = 1
  ORDER BY r.ts;
$$;

SELECT cron.schedule(
  'hedge-bot-tick-10s',
  '10 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/hedge-bot-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public._cron_secret()
    ),
    body := '{}'::jsonb
  );
  $$
);