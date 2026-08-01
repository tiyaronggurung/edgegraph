SELECT cron.unschedule('ops-auto-trade-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-auto-trade-tick');

SELECT cron.schedule(
  'ops-auto-trade-tick',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/ops-auto-trade-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._cron_secret()
    ),
    body := '{}'::jsonb
  );
  $$
);