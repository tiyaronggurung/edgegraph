CREATE TABLE public.btc_flow_lean_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start TIMESTAMPTZ NOT NULL,
  seconds_to_close INTEGER,
  lean TEXT NOT NULL,
  imb_m3 NUMERIC,
  imb_window NUMERIC,
  vol_window_btc NUMERIC,
  buy_window_btc NUMERIC,
  sell_window_btc NUMERIC,
  spot NUMERIC,
  expected_win_rate NUMERIC
);
CREATE INDEX idx_btc_flow_lean_window ON public.btc_flow_lean_log (window_start DESC);
GRANT SELECT, INSERT ON public.btc_flow_lean_log TO authenticated;
GRANT ALL ON public.btc_flow_lean_log TO service_role;
ALTER TABLE public.btc_flow_lean_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read flow lean log" ON public.btc_flow_lean_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated can insert flow lean log" ON public.btc_flow_lean_log FOR INSERT TO authenticated WITH CHECK (true);