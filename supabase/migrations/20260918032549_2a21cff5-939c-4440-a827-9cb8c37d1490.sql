-- lovable-cron-fallback-reviewed: 1440 runs/day; per-minute capture is required because each 15m window needs in/out volume logged before close, and no event-driven source exists for Binance klines
SELECT cron.schedule(
  'flow-lean-writer',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/flow-lean-writer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public._cron_secret()
    ),
    body := '{}'::jsonb
  );
  $cron$
);