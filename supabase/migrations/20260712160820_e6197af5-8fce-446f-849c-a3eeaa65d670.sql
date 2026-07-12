
ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS physics_prob      numeric,
  ADD COLUMN IF NOT EXISTS independent_prob  numeric,
  ADD COLUMN IF NOT EXISTS jump_features     jsonb;

CREATE TABLE IF NOT EXISTS public.btc_isotonic_fit (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null,
  time_bucket    text,
  pins           jsonb not null,
  n_train        integer not null,
  n_test         integer not null,
  brier_train    numeric,
  brier_test     numeric,
  logloss_train  numeric,
  logloss_test   numeric,
  fitted_at      timestamptz not null default now(),
  data_cutoff    timestamptz,
  code_version   text
);

GRANT SELECT ON public.btc_isotonic_fit TO authenticated;
GRANT ALL    ON public.btc_isotonic_fit TO service_role;
ALTER TABLE public.btc_isotonic_fit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read isotonic fits"
  ON public.btc_isotonic_fit FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_btc_isotonic_fit_scope_time
  ON public.btc_isotonic_fit (scope, time_bucket, fitted_at DESC);
