
CREATE TABLE public.live_predictions (
  fixture_id text PRIMARY KEY,
  provider_id text NOT NULL,
  league text,
  home_team text NOT NULL,
  away_team text NOT NULL,
  status text,
  elapsed integer,
  goals_home integer NOT NULL DEFAULT 0,
  goals_away integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  stats jsonb NOT NULL,
  markets jsonb NOT NULL,
  explanation jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prediction_history (
  id bigserial PRIMARY KEY,
  fixture_id text NOT NULL,
  market text NOT NULL,
  pick text NOT NULL,
  line numeric,
  probability numeric NOT NULL,
  stats_prob numeric,
  ai_prob numeric,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prediction_history_fixture_time_idx
  ON public.prediction_history (fixture_id, computed_at DESC);

GRANT SELECT ON public.live_predictions TO anon, authenticated;
GRANT ALL ON public.live_predictions TO service_role;

GRANT SELECT ON public.prediction_history TO anon, authenticated;
GRANT ALL ON public.prediction_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.prediction_history_id_seq TO service_role;

ALTER TABLE public.live_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_predictions public read"
  ON public.live_predictions FOR SELECT
  USING (true);

CREATE POLICY "prediction_history public read"
  ON public.prediction_history FOR SELECT
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_predictions;
ALTER TABLE public.live_predictions REPLICA IDENTITY FULL;
