ALTER TABLE public.auto_odds_decision_log
  ADD COLUMN IF NOT EXISTS would_skip_bucket_d boolean,
  ADD COLUMN IF NOT EXISTS would_skip_extreme_kalshi_weak_model boolean;