CREATE OR REPLACE VIEW public.btc_ta_reblend_shadow AS
SELECT
  p.ticker,
  p.close_time,
  p.side,
  p.model_prob,
  p.ta_score,
  p.was_correct,
  p.outcome,
  p.snapshot_seconds_to_close,
  -- Softer +/-15pt re-blend of ta_score into model_prob on the LOCKED side.
  -- ta_score is in [-100, +100] where positive = bullish. Positive score
  -- lifts YES / lowers NO by up to 15pt; negative does the reverse.
  GREATEST(0.01, LEAST(0.99,
    p.model_prob + (CASE WHEN p.side = 'YES' THEN 1 ELSE -1 END)
                  * COALESCE(p.ta_score, 0) / 100.0 * 0.15
  )) AS shadow_model_prob,
  -- Chosen-side confidence under the shadow blend.
  GREATEST(0.01, LEAST(0.99,
    (CASE WHEN p.side = 'YES'
          THEN p.model_prob + COALESCE(p.ta_score, 0) / 100.0 * 0.15
          ELSE (1 - p.model_prob) + COALESCE(p.ta_score, 0) / 100.0 * 0.15 * -1
     END)
  )) AS shadow_side_conf
FROM public.btc_model_predictions p
WHERE p.outcome IS NOT NULL
  AND p.ta_score IS NOT NULL
  AND p.settled_at >= now() - INTERVAL '30 days';

GRANT SELECT ON public.btc_ta_reblend_shadow TO authenticated;
GRANT SELECT ON public.btc_ta_reblend_shadow TO service_role;
