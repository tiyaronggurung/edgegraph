CREATE OR REPLACE FUNCTION public.trendline_break_study(_days integer DEFAULT 14)
RETURNS TABLE(
  bucket text,
  n bigint,
  pct_up numeric,
  avg_dist_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH snaps AS (
    SELECT
      s.ticker,
      s.evaluated_at,
      s.spot,
      s.upper_price_now AS resist,
      s.lower_price_now AS support,
      p.close_time,
      p.outcome
    FROM public.btc_trendline_shadow s
    JOIN public.btc_model_predictions p ON p.ticker = s.ticker
    WHERE s.evaluated_at >= now() - (_days || ' days')::interval
      AND s.upper_price_now IS NOT NULL
      AND s.lower_price_now IS NOT NULL
      AND s.upper_price_now > s.lower_price_now
      AND p.outcome IN ('YES','NO')
      AND s.evaluated_at < p.close_time
      AND s.evaluated_at >= p.close_time - INTERVAL '15 minutes'
  ),
  enriched AS (
    SELECT
      sn.*,
      (SELECT max(t.spot) FROM public.btc_spot_ticks t
        WHERE t.observed_at > sn.evaluated_at AND t.observed_at <= sn.close_time) AS max_spot,
      (SELECT min(t.spot) FROM public.btc_spot_ticks t
        WHERE t.observed_at > sn.evaluated_at AND t.observed_at <= sn.close_time) AS min_spot
    FROM snaps sn
  ),
  labeled AS (
    SELECT
      CASE
        WHEN min_spot IS NULL OR max_spot IS NULL THEN 'no_ticks'
        WHEN min_spot < support AND max_spot > resist THEN 'both_broken'
        WHEN min_spot < support THEN 'support_broken'
        WHEN max_spot > resist  THEN 'resist_broken'
        ELSE 'both_held'
      END AS bucket,
      (outcome = 'YES') AS up_win,
      CASE WHEN spot > 0 THEN (resist - support) / spot * 100.0 ELSE NULL END AS width_pct
    FROM enriched
  )
  SELECT
    bucket,
    count(*)::bigint AS n,
    ROUND(100.0 * avg(CASE WHEN up_win THEN 1 ELSE 0 END), 1) AS pct_up,
    ROUND(avg(width_pct)::numeric, 3) AS avg_dist_pct
  FROM labeled
  WHERE bucket <> 'no_ticks'
  GROUP BY bucket
  ORDER BY n DESC;
$$;

GRANT EXECUTE ON FUNCTION public.trendline_break_study(integer) TO authenticated;