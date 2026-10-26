CREATE TABLE public.live_odds_windows_5m (
  window_start timestamptz PRIMARY KEY,
  strike numeric,
  close_spot numeric,
  result text,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  poly_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.live_odds_windows_5m TO authenticated;
GRANT ALL ON public.live_odds_windows_5m TO service_role;
ALTER TABLE public.live_odds_windows_5m ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read 5m odds windows" ON public.live_odds_windows_5m FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert 5m odds windows" ON public.live_odds_windows_5m FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update 5m odds windows" ON public.live_odds_windows_5m FOR UPDATE TO authenticated USING (true) WITH CHECK (true);