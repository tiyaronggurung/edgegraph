-- 1. Table: shared BTC candle cache (not user-specific, purely a data cache)
CREATE TABLE IF NOT EXISTS public.btc_candles (
  tf           TEXT        NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  o            NUMERIC     NOT NULL,
  h            NUMERIC     NOT NULL,
  l            NUMERIC     NOT NULL,
  c            NUMERIC     NOT NULL,
  v            NUMERIC,
  source       TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tf, bucket_start)
);

CREATE INDEX IF NOT EXISTS btc_candles_tf_time_idx
  ON public.btc_candles (tf, bucket_start DESC);

-- 2. Grants — signed-in users read, service role writes
GRANT SELECT ON public.btc_candles TO authenticated;
GRANT ALL    ON public.btc_candles TO service_role;

-- 3. RLS
ALTER TABLE public.btc_candles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "btc_candles_read_all_authenticated" ON public.btc_candles;
CREATE POLICY "btc_candles_read_all_authenticated"
  ON public.btc_candles
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. Retention helper — called by cron
CREATE OR REPLACE FUNCTION public.prune_btc_candles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.btc_candles WHERE tf = '1m'  AND bucket_start < now() - INTERVAL '7 days';
  DELETE FROM public.btc_candles WHERE tf = '5m'  AND bucket_start < now() - INTERVAL '30 days';
  DELETE FROM public.btc_candles WHERE tf = '15m' AND bucket_start < now() - INTERVAL '90 days';
  -- 1h / 1d / 1w retained indefinitely (tiny row counts)
END;
$$;