CREATE TABLE public.live_odds_windows (
  window_start timestamptz PRIMARY KEY,
  strike numeric,
  close_spot numeric,
  result text,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.live_odds_windows TO authenticated;
GRANT ALL ON public.live_odds_windows TO service_role;
ALTER TABLE public.live_odds_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read odds windows" ON public.live_odds_windows FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert odds windows" ON public.live_odds_windows FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update odds windows" ON public.live_odds_windows FOR UPDATE TO authenticated USING (true) WITH CHECK (true);