ALTER TABLE public.auto_odds_decision_log
  ADD COLUMN IF NOT EXISTS signed_edge numeric,
  ADD COLUMN IF NOT EXISTS entry_ask_prob numeric,
  ADD COLUMN IF NOT EXISTS sigma_distance numeric,
  ADD COLUMN IF NOT EXISTS odds_band_eligible boolean,
  ADD COLUMN IF NOT EXISTS signed_edge_veto_003_would_skip boolean,
  ADD COLUMN IF NOT EXISTS signed_edge_veto_005_would_skip boolean,
  ADD COLUMN IF NOT EXISTS signed_edge_veto_008_would_skip boolean,
  ADD COLUMN IF NOT EXISTS theoretical_pnl_100 numeric,
  ADD COLUMN IF NOT EXISTS realized_pnl_usd numeric;

CREATE INDEX IF NOT EXISTS auto_odds_decision_log_ticker_created_idx
  ON public.auto_odds_decision_log (ticker, created_at DESC);