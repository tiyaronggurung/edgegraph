
-- 1. Extend settings with tunables + auto-apply toggle
ALTER TABLE public.auto_odds_settings
  ADD COLUMN IF NOT EXISTS auto_apply_studies boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS model_gate_min numeric,
  ADD COLUMN IF NOT EXISTS hedge_band_lo numeric,
  ADD COLUMN IF NOT EXISTS hedge_band_hi numeric,
  ADD COLUMN IF NOT EXISTS tp_cents integer,
  ADD COLUMN IF NOT EXISTS oscillation_max integer,
  ADD COLUMN IF NOT EXISTS skip_bucket_lt15s boolean,
  ADD COLUMN IF NOT EXISTS skip_bucket_15_60s boolean;

-- 2. Odds studies (AI output)
CREATE TABLE IF NOT EXISTS public.auto_odds_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary text,
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  tunings jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_tunings jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  raw jsonb,
  rows_analyzed integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_studies TO authenticated;
GRANT ALL ON public.auto_odds_studies TO service_role;
ALTER TABLE public.auto_odds_studies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own odds studies"
  ON public.auto_odds_studies FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS auto_odds_studies_user_created_idx
  ON public.auto_odds_studies (user_id, created_at DESC);

-- 3. Audit trail for every applied tuning (for reverts and post-hoc analysis)
CREATE TABLE IF NOT EXISTS public.auto_odds_tuning_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  study_id uuid REFERENCES public.auto_odds_studies(id) ON DELETE SET NULL,
  param text NOT NULL,
  prev_value jsonb,
  new_value jsonb,
  rationale text,
  confidence numeric,
  source text NOT NULL DEFAULT 'ai_auto',
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_tuning_audit TO authenticated;
GRANT ALL ON public.auto_odds_tuning_audit TO service_role;
ALTER TABLE public.auto_odds_tuning_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tuning audit"
  ON public.auto_odds_tuning_audit FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS auto_odds_tuning_audit_user_created_idx
  ON public.auto_odds_tuning_audit (user_id, created_at DESC);
