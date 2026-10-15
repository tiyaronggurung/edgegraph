-- lovable-cron-fallback-reviewed: 8640 runs/day; Option B needs a chart odds reading under 20s old and each window needs its odds line saved with no page open; no event source exists for odds
SELECT cron.schedule(
  'live-odds-writer',
  '10 seconds',
  $cron$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/live-odds-writer',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public._cron_secret()),
    body := '{}'::jsonb
  );
  $cron$
);