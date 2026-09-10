-- lovable-cron-fallback-reviewed: 288 runs/day; fixed five-minute checkpoints require unattended time-based capture while the page is closed, using cached candles only with no AI or trading
SELECT cron.schedule(
  'btc-hourly-forecast-shadow-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/hourly-forecast-tick',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public._cron_secret()),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);