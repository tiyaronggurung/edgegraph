
-- Loss autopsy: read-only observation of losing predictions.
-- Zero impact on live logic. Classifies each LOSS by failure mode.

CREATE TABLE public.model_loss_autopsy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL UNIQUE,
  close_time TIMESTAMPTZ NOT NULL,
  model_side TEXT NOT NULL,
  outcome TEXT NOT NULL,
  model_prob NUMERIC NOT NULL,
  edge_pts NUMERIC,
  spot_at_snapshot NUMERIC,
  strike NUMERIC,
  strike_distance_pct NUMERIC,
  snapshot_seconds_to_close INTEGER,
  flip_count INTEGER,
  ta_score DOUBLE PRECISION,
  ta_engine_version TEXT,
  chart_verdict TEXT,
  failure_tags TEXT[] NOT NULL DEFAULT '{}',
  primary_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loss_autopsy_close_time ON public.model_loss_autopsy(close_time DESC);
CREATE INDEX idx_loss_autopsy_primary_tag ON public.model_loss_autopsy(primary_tag);

GRANT SELECT ON public.model_loss_autopsy TO authenticated;
GRANT ALL ON public.model_loss_autopsy TO service_role;
ALTER TABLE public.model_loss_autopsy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read loss autopsy"
  ON public.model_loss_autopsy FOR SELECT
  TO authenticated
  USING (true);

-- Classifier: scans recent settled losses, tags them, upserts.
CREATE OR REPLACE FUNCTION public.run_loss_autopsy()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  WITH losses AS (
    SELECT
      p.ticker,
      p.close_time,
      p.side AS model_side,
      p.outcome,
      p.model_prob,
      p.edge_pts,
      p.spot_at_snapshot,
      p.strike,
      CASE WHEN p.strike > 0
        THEN ABS(p.spot_at_snapshot - p.strike) / p.strike * 100
        ELSE NULL END AS strike_distance_pct,
      p.snapshot_seconds_to_close,
      p.flip_count,
      p.ta_score,
      p.ta_engine_version,
      p.chart_verdict
    FROM public.btc_model_predictions p
    WHERE p.was_correct = false
      AND p.close_time >= now() - INTERVAL '7 days'
      AND p.close_time <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.model_loss_autopsy a WHERE a.ticker = p.ticker
      )
  ),
  tagged AS (
    SELECT
      l.*,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN l.model_prob >= 0.90 THEN 'high_conf_miss' END,
        CASE WHEN l.strike_distance_pct IS NOT NULL
                  AND l.strike_distance_pct < 0.05 THEN 'near_strike_flip' END,
        CASE WHEN l.edge_pts IS NOT NULL AND ABS(l.edge_pts) < 3 THEN 'low_edge' END,
        CASE WHEN l.snapshot_seconds_to_close IS NOT NULL
                  AND l.snapshot_seconds_to_close < 30 THEN 'late_snapshot_only' END,
        CASE WHEN l.flip_count >= 2 THEN 'unstable_flips' END,
        CASE WHEN l.ta_score IS NOT NULL AND (
                    (l.model_side = 'YES' AND l.ta_score <= -15) OR
                    (l.model_side = 'NO'  AND l.ta_score >=  15)
                  ) THEN 'ta_disagreed' END,
        CASE WHEN l.chart_verdict IS NOT NULL AND (
                    (l.model_side = 'YES' AND l.chart_verdict = 'bear') OR
                    (l.model_side = 'NO'  AND l.chart_verdict = 'bull')
                  ) THEN 'chart_disagreed' END
      ], NULL) AS tags
    FROM losses l
  ),
  with_chop AS (
    SELECT
      t.*,
      -- chop_reversal: previous 3 windows also alternated (outcome flipped each window)
      CASE WHEN (
        SELECT COUNT(DISTINCT outcome) = 2 AND COUNT(*) >= 3
        FROM public.btc_model_predictions prev
        WHERE prev.close_time < t.close_time
          AND prev.close_time >= t.close_time - INTERVAL '45 minutes'
          AND prev.outcome IS NOT NULL
      ) THEN array_append(t.tags, 'chop_reversal') ELSE t.tags END AS final_tags
    FROM tagged t
  )
  INSERT INTO public.model_loss_autopsy (
    ticker, close_time, model_side, outcome, model_prob, edge_pts,
    spot_at_snapshot, strike, strike_distance_pct, snapshot_seconds_to_close,
    flip_count, ta_score, ta_engine_version, chart_verdict,
    failure_tags, primary_tag
  )
  SELECT
    ticker, close_time, model_side, outcome, model_prob, edge_pts,
    spot_at_snapshot, strike, strike_distance_pct, snapshot_seconds_to_close,
    flip_count, ta_score, ta_engine_version, chart_verdict,
    COALESCE(final_tags, '{}'),
    COALESCE(final_tags[1], 'uncategorized')
  FROM with_chop
  ON CONFLICT (ticker) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;
