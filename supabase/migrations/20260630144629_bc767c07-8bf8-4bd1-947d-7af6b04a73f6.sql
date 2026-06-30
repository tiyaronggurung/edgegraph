
CREATE TABLE public.btc_model_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_ticker TEXT,
  strike NUMERIC NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  model_prob NUMERIC NOT NULL,
  market_yes_price NUMERIC NOT NULL,
  edge_pts NUMERIC NOT NULL,
  spot_at_snapshot NUMERIC NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  snapshot_seconds_to_close INTEGER NOT NULL,
  settle_price NUMERIC,
  outcome TEXT CHECK (outcome IN ('YES','NO')),
  was_correct BOOLEAN,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker)
);

GRANT SELECT ON public.btc_model_predictions TO authenticated;
GRANT ALL ON public.btc_model_predictions TO service_role;

ALTER TABLE public.btc_model_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read predictions"
  ON public.btc_model_predictions FOR SELECT
  TO authenticated USING (true);

CREATE INDEX idx_btc_pred_close_time ON public.btc_model_predictions (close_time DESC);
CREATE INDEX idx_btc_pred_unsettled ON public.btc_model_predictions (close_time) WHERE outcome IS NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_btc_pred_updated_at
  BEFORE UPDATE ON public.btc_model_predictions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
