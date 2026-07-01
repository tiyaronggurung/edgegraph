
CREATE TABLE public.crypto_study_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  study_id UUID NOT NULL REFERENCES public.crypto_model_studies(id) ON DELETE CASCADE,
  rec_index INTEGER NOT NULL,
  rec_gate TEXT,
  rec_suggested TEXT,
  vote TEXT NOT NULL CHECK (vote IN ('up','down')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, study_id, rec_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_study_feedback TO authenticated;
GRANT ALL ON public.crypto_study_feedback TO service_role;

ALTER TABLE public.crypto_study_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own study feedback"
  ON public.crypto_study_feedback
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_crypto_study_feedback_updated_at
  BEFORE UPDATE ON public.crypto_study_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX crypto_study_feedback_study_idx ON public.crypto_study_feedback(study_id);
CREATE INDEX crypto_study_feedback_user_idx ON public.crypto_study_feedback(user_id, created_at DESC);
