-- Reset near-strike settlements likely mislabeled via Coinbase spot fallback.
-- The settle cron will re-settle from Kalshi's authoritative expiration_value.
UPDATE public.btc_model_predictions
SET outcome = NULL, was_correct = NULL, settle_price = NULL, settled_at = NULL
WHERE close_time >= now() - interval '7 days'
  AND outcome IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (settled_at - close_time))) < 90
  AND ABS(settle_price - strike) < 30;