
CREATE TABLE public.big_flip_lead_shadow (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  cheap_side TEXT NOT NULL,
  cheap_ask_cents INTEGER NOT NULL,
  model_side TEXT,
  model_prob NUMERIC,
  spot NUMERIC,
  strike NUMERIC,
  seconds_to_close INTEGER,
  brr_proxy NUMERIC,
  brr_sample_count INTEGER,
  lead_delta NUMERIC,
  gate_decision TEXT NOT NULL,
  gate_reason TEXT,
  live_fired BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT,
  pnl_usd NUMERIC
);

CREATE INDEX idx_big_flip_lead_shadow_user_created ON public.big_flip_lead_shadow (user_id, created_at DESC);
CREATE INDEX idx_big_flip_lead_shadow_ticker ON public.big_flip_lead_shadow (ticker);

GRANT SELECT ON public.big_flip_lead_shadow TO authenticated;
GRANT ALL ON public.big_flip_lead_shadow TO service_role;

ALTER TABLE public.big_flip_lead_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lead shadow rows"
  ON public.big_flip_lead_shadow FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
