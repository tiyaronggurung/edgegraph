CREATE OR REPLACE FUNCTION public.mid_support_study(_days integer DEFAULT 7)
RETURNS TABLE (
  bucket text,
  n bigint,
  pct_up numeric,
  avg_mid_dist_pct numeric,
  edge_vs_baseline numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH snaps AS (
    SELECT
      s.ticker,
      s.evaluated_at,
      s.spot,
      s.strike,
      s.seconds_to_close,
      s.upper_price_now AS sell_p,
      s.lower_price_now AS buy_p,
      ((s.upper_price_now + s.lower_price_now) / 2.0) AS mid_p,
      p.outcome,
      row_number() OVER (
        PARTITION BY s.ticker,
          CASE
            WHEN s.seconds_to_close <= 60  THEN 'T60'
            WHEN s.seconds_to_close <= 180 THEN 'T180'
            WHEN s.seconds_to_close <= 420 THEN 'T420'
            ELSE 'EARLY'
          END
        ORDER BY abs(s.seconds_to_close - CASE
            WHEN s.seconds_to_close <= 60  THEN 30
            WHEN s.seconds_to_close <= 180 THEN 120
            WHEN s.seconds_to_close <= 420 THEN 300
            ELSE 600
          END)
      ) AS rn,
      CASE
        WHEN s.seconds_to_close <= 60  THEN 'T-30s'
        WHEN s.seconds_to_close <= 180 THEN 'T-120s'
        WHEN s.seconds_to_close <= 420 THEN 'T-300s'
        ELSE 'T-600s'
      END AS bucket
    FROM public.btc_trendline_shadow s
    JOIN public.btc_model_predictions p ON p.ticker = s.ticker
    WHERE s.evaluated_at >= now() - (_days || ' days')::interval
      AND s.upper_price_now IS NOT NULL
      AND s.lower_price_now IS NOT NULL
      AND s.upper_price_now > s.lower_price_now
      AND s.strike IS NOT NULL
      AND p.outcome IN ('YES','NO')
  ),
  picked AS (
    SELECT * FROM snaps WHERE rn = 1
  ),
  labeled AS (
    -- Test: does side-of-MID at time T predict the side-of-strike at settlement?
    -- "Correct" = (spot above MID at T)  matches (outcome = YES i.e. closed above strike)
    SELECT
      bucket,
      (spot >= mid_p)      AS above_mid,
      (outcome = 'YES')    AS closed_up,
      CASE WHEN mid_p > 0 THEN abs(spot - mid_p) / mid_p * 100.0 END AS mid_dist_pct
    FROM picked
  ),
  agg AS (
    SELECT
      bucket,
      count(*)::bigint AS n,
      avg(CASE WHEN closed_up THEN 1 ELSE 0 END) AS baseline_up,
      avg(CASE WHEN above_mid = closed_up THEN 1 ELSE 0 END) AS agree_rate,
      avg(mid_dist_pct) AS avg_mid_dist_pct
    FROM labeled
    GROUP BY bucket
  )
  SELECT
    bucket,
    n,
    ROUND(100.0 * agree_rate, 1) AS pct_up,
    ROUND(avg_mid_dist_pct::numeric, 3) AS avg_mid_dist_pct,
    ROUND(100.0 * (agree_rate - GREATEST(baseline_up, 1 - baseline_up)), 1) AS edge_vs_baseline
  FROM agg
  ORDER BY CASE bucket
    WHEN 'T-600s' THEN 1
    WHEN 'T-300s' THEN 2
    WHEN 'T-120s' THEN 3
    WHEN 'T-30s'  THEN 4
    ELSE 5
  END;
$$;

GRANT EXECUTE ON FUNCTION public.mid_support_study(integer) TO authenticated, service_role;