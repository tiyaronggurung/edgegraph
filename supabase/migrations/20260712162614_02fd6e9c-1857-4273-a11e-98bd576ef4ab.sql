CREATE TABLE public.btc_spot_ticks (
  id BIGSERIAL PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  observed_at_sec BIGINT NOT NULL,
  source_timestamp TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latency_ms INT,
  spot NUMERIC(14,4) NOT NULL,
  source TEXT NOT NULL,
  volume NUMERIC,
  aggressor_side TEXT,
  bid NUMERIC,
  ask NUMERIC
);

CREATE INDEX btc_spot_ticks_observed_at_desc ON public.btc_spot_ticks (observed_at DESC);
CREATE INDEX btc_spot_ticks_source_observed_at_desc ON public.btc_spot_ticks (source, observed_at DESC);
CREATE UNIQUE INDEX btc_spot_ticks_dedup_source_ts ON public.btc_spot_ticks (source, source_timestamp) WHERE source_timestamp IS NOT NULL;
CREATE UNIQUE INDEX btc_spot_ticks_dedup_rounded ON public.btc_spot_ticks (source, observed_at_sec) WHERE source_timestamp IS NULL;

GRANT SELECT ON public.btc_spot_ticks TO authenticated;
GRANT ALL ON public.btc_spot_ticks TO service_role;

ALTER TABLE public.btc_spot_ticks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read spot ticks"
  ON public.btc_spot_ticks FOR SELECT
  TO authenticated
  USING (true);

SELECT cron.schedule(
  'btc-spot-ticks-retention',
  '*/5 * * * *',
  $$ DELETE FROM public.btc_spot_ticks WHERE observed_at < now() - interval '20 minutes'; $$
);