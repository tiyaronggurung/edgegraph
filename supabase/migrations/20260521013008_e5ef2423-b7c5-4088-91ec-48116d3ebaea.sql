ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS closing_odds numeric,
  ADD COLUMN IF NOT EXISTS closing_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS clv_percent numeric;

CREATE INDEX IF NOT EXISTS idx_bets_closing_captured
  ON public.bets (user_id, closing_captured_at)
  WHERE closing_odds IS NULL;