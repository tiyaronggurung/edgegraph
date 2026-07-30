SELECT cron.schedule(
  'kalshi-book-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/kalshi-book-tick',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public._cron_secret()),
    body := '{}'::jsonb
  );
  $$
);