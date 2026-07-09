
ALTER TABLE public.btc_polymarket_triple_window
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS enrichment_json JSONB;

CREATE INDEX IF NOT EXISTS idx_btc_ptw_updated_at
  ON public.btc_polymarket_triple_window (updated_at);

DROP TRIGGER IF EXISTS trg_btc_ptw_updated_at ON public.btc_polymarket_triple_window;
CREATE TRIGGER trg_btc_ptw_updated_at
  BEFORE UPDATE ON public.btc_polymarket_triple_window
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
