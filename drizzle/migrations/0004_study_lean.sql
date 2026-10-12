-- Study lean: always-on UP/DOWN lean for the paper test + screen.
-- Separate columns — the real Study lock (study_locked_side) is untouched.
ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS study_lean_side text,
  ADD COLUMN IF NOT EXISTS study_lean_conf numeric,
  ADD COLUMN IF NOT EXISTS study_lean_ratio numeric,
  ADD COLUMN IF NOT EXISTS study_lean_at timestamptz;

SELECT cron.unschedule('study-lean-tick-60s');
SELECT cron.schedule(
  'study-lean-tick-60s',
  '60 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/study-lean-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public._cron_secret()
    ),
    body := '{}'::jsonb
  );
  $$
);
