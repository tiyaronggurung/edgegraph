-- lovable-cron-fallback-reviewed: price-buffer measurement needs 30s sampling; user informed of 2880 runs/day
CREATE TABLE public.btc_spot_buffer_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  seconds_to_close integer,
  coinbase_px numeric,
  bitstamp_px numeric,
  kraken_px numeric,
  gemini_px numeric,
  binance_px numeric,
  bitfinex_px numeric,
  our_composite numeric,
  cf_reference numeric,
  buffer_usd numeric,
  buffer_bps numeric,
  venues_used integer,
  strike numeric
);

GRANT SELECT ON public.btc_spot_buffer_log TO authenticated;
GRANT ALL ON public.btc_spot_buffer_log TO service_role;

ALTER TABLE public.btc_spot_buffer_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read spot buffer log"
ON public.btc_spot_buffer_log FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_btc_spot_buffer_log_created ON public.btc_spot_buffer_log (created_at DESC);
CREATE INDEX idx_btc_spot_buffer_log_window ON public.btc_spot_buffer_log (window_start DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-spot-buffer-writer') THEN
    PERFORM cron.unschedule('btc-spot-buffer-writer');
  END IF;
END $$;

SELECT cron.schedule(
  'btc-spot-buffer-writer',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/spot-buffer-writer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);