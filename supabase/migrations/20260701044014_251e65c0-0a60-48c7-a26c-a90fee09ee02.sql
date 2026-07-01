-- Add snapshot fields for pricing study
ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS sigma_at_snapshot numeric,
  ADD COLUMN IF NOT EXISTS theory_yes_prob numeric,
  ADD COLUMN IF NOT EXISTS time_bucket text;

CREATE INDEX IF NOT EXISTS idx_btc_pred_time_bucket ON public.btc_model_predictions (time_bucket, outcome);

-- Calibration table: per (time_bucket x sigma_bucket), rolling win-rate + correction factor
CREATE TABLE IF NOT EXISTS public.btc_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_bucket text NOT NULL,
  sigma_bucket text NOT NULL,
  n_samples integer NOT NULL DEFAULT 0,
  n_correct integer NOT NULL DEFAULT 0,
  avg_model_prob numeric,
  avg_market_prob numeric,
  avg_theory_prob numeric,
  actual_rate numeric,
  correction_factor numeric NOT NULL DEFAULT 1.0,
  last_fitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (time_bucket, sigma_bucket)
);

GRANT SELECT ON public.btc_calibration TO authenticated;
GRANT ALL ON public.btc_calibration TO service_role;

ALTER TABLE public.btc_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read calibration"
  ON public.btc_calibration FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_btc_calibration_updated_at
  BEFORE UPDATE ON public.btc_calibration
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Nightly cron: refit calibration from settled predictions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('btc-calibration-refit') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-calibration-refit');

SELECT cron.schedule(
  'btc-calibration-refit',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--921f21f3-4144-4400-a0a1-781603e22b1b.lovable.app/api/public/hooks/btc-calibrate',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5Y3hqenNiZXV2cnZoaWJzYXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDc3MTEsImV4cCI6MjA5NDg4MzcxMX0.MByAqmctHUB1B7zv_7hpz9mSvlLCoQFh0i4EjqVii18"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);