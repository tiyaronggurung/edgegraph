CREATE TABLE public.btc_agreement_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  window_start timestamptz NOT NULL,
  bucket_sec bigint NOT NULL,
  seconds_to_close integer,
  spot numeric,
  strike numeric,
  odds_side text,
  odds_p_up numeric,
  vol_side text,
  vol_imbalance numeric,
  model_side text,
  model_confidence numeric,
  study_side text,
  study_confidence numeric,
  agree_count integer,
  agreed_side text,
  all_four boolean NOT NULL DEFAULT false,
  held_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, bucket_sec)
);

GRANT SELECT, INSERT ON public.btc_agreement_log TO authenticated;
GRANT ALL ON public.btc_agreement_log TO service_role;

ALTER TABLE public.btc_agreement_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read agreement log"
  ON public.btc_agreement_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages agreement log"
  ON public.btc_agreement_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_btc_agreement_log_window ON public.btc_agreement_log (window_start DESC);
CREATE INDEX idx_btc_agreement_log_allfour ON public.btc_agreement_log (all_four, created_at DESC);

CREATE TRIGGER update_btc_agreement_log_updated_at
  BEFORE UPDATE ON public.btc_agreement_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();