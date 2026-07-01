
CREATE TABLE IF NOT EXISTS public.crypto_model_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  misses_analyzed integer NOT NULL DEFAULT 0,
  wins_analyzed integer NOT NULL DEFAULT 0,
  miss_id_watermark uuid,
  model text NOT NULL,
  summary text NOT NULL,
  dominant_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crypto_model_studies_user_created_idx
  ON public.crypto_model_studies (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_model_studies TO authenticated;
GRANT ALL ON public.crypto_model_studies TO service_role;

ALTER TABLE public.crypto_model_studies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own crypto model studies"
  ON public.crypto_model_studies
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
