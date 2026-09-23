-- lovable-cron-fallback-reviewed: live 15m betting window needs 30s polling to catch a 90s agreement hold; user told 2880 runs/day
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS agreement_bet_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_bet_live_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_bet_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_bet_stake_cents integer NOT NULL DEFAULT 10000;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-agreement-bet-tick') THEN
    PERFORM cron.unschedule('btc-agreement-bet-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'btc-agreement-bet-tick',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/agreement-bet-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);