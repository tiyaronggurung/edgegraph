
CREATE TABLE public.prediction_closes (
  id bigserial PRIMARY KEY,
  fixture_id text NOT NULL,
  market text NOT NULL,
  pick text NOT NULL,
  line numeric,
  ensemble_prob numeric NOT NULL,
  stats_prob numeric,
  ai_prob numeric,
  market_prob numeric,
  outcome boolean,
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, market, pick, line)
);

CREATE INDEX prediction_closes_fixture_idx
  ON public.prediction_closes (fixture_id);

GRANT SELECT ON public.prediction_closes TO anon, authenticated;
GRANT ALL ON public.prediction_closes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.prediction_closes_id_seq TO service_role;

ALTER TABLE public.prediction_closes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prediction_closes public read"
  ON public.prediction_closes FOR SELECT
  USING (true);
