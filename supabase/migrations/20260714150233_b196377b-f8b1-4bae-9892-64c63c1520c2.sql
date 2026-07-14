
CREATE TABLE public.auto_model_bet_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ticker TEXT,
  side TEXT,
  price_cents INTEGER,
  stake_usd NUMERIC,
  stage TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auto_model_bet_errors_user_created_idx ON public.auto_model_bet_errors(user_id, created_at DESC);
GRANT SELECT ON public.auto_model_bet_errors TO authenticated;
GRANT ALL ON public.auto_model_bet_errors TO service_role;
ALTER TABLE public.auto_model_bet_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own model bet errors" ON public.auto_model_bet_errors
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
