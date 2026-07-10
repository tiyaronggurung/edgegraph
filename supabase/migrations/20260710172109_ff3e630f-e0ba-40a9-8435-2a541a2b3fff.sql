SELECT cron.schedule(
  'martingale-tick-20s',
  '20 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/martingale-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5Y3hqenNiZXV2cnZoaWJzYXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDc3MTEsImV4cCI6MjA5NDg4MzcxMX0.MByAqmctHUB1B7zv_7hpz9mSvlLCoQFh0i4EjqVii18'
    ),
    body := '{}'::jsonb
  );
  $$
);