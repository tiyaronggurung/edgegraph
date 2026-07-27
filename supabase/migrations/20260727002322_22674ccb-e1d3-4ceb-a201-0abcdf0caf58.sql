
ALTER TABLE public.btc_trendline_shadow
  ADD COLUMN IF NOT EXISTS next_return_15m numeric;

CREATE TABLE IF NOT EXISTS public.btc_trendline_config (
  id integer PRIMARY KEY DEFAULT 1,
  booster_mode text NOT NULL DEFAULT 'follow',
  min_channel_width_pct numeric NOT NULL DEFAULT 0,
  min_swings integer NOT NULL DEFAULT 0,
  quality_gates_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT btc_trendline_config_singleton CHECK (id = 1),
  CONSTRAINT btc_trendline_config_mode CHECK (booster_mode IN ('follow','fade','off'))
);

GRANT SELECT ON public.btc_trendline_config TO authenticated;
GRANT ALL ON public.btc_trendline_config TO service_role;

ALTER TABLE public.btc_trendline_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read trendline config"
  ON public.btc_trendline_config FOR SELECT TO authenticated USING (true);

INSERT INTO public.btc_trendline_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
