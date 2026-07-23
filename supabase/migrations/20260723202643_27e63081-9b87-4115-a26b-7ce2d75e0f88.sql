
CREATE TABLE IF NOT EXISTS public.ev_decision_log (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_ticker TEXT,
  close_time TIMESTAMPTZ NOT NULL,
  snapshot_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_bucket TEXT NOT NULL,       -- '13m+' | '10m' | '5m' | '2m' | '1m' | '30s'
  seconds_to_close INTEGER NOT NULL,

  model_prob NUMERIC NOT NULL,         -- P(YES) from the full model
  model_side TEXT NOT NULL,            -- 'YES' | 'NO' (the side the model would take)
  model_side_prob NUMERIC NOT NULL,    -- P(model_side) = YES:model_prob, NO:1-model_prob

  kalshi_yes_price NUMERIC NOT NULL,   -- 0..1
  kalshi_no_price NUMERIC NOT NULL,    -- 0..1 (= 1 - yes)
  selected_side_ask NUMERIC NOT NULL,  -- ask on model_side (dollars per contract)
  market_implied_prob NUMERIC NOT NULL,-- == selected_side_ask for now
  edge_prob NUMERIC NOT NULL,          -- model_side_prob - market_implied_prob
  edge_pts NUMERIC NOT NULL,           -- edge_prob * 100

  fee_est NUMERIC NOT NULL,            -- 0.07 * ask * (1-ask) per contract
  ev_per_contract NUMERIC NOT NULL,    -- model_side_prob - ask - fee_est
  ev_per_stake_10 NUMERIC NOT NULL,    -- ev_per_contract * (10 / ask)
  would_fire BOOLEAN NOT NULL,         -- ev_per_stake_10 > 0

  actual_outcome TEXT,                 -- 'YES' | 'NO', filled on settle
  was_correct BOOLEAN,                 -- outcome == model_side
  realized_pnl_10 NUMERIC,             -- hypothetical $10 stake P/L, filled on settle
  settled_at TIMESTAMPTZ,

  regime_tag TEXT,                     -- Phase 3
  spot_at_snapshot NUMERIC,
  strike NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent per (ticker, bucket): repeat snapshots in the same bucket are dropped
CREATE UNIQUE INDEX IF NOT EXISTS ev_decision_log_ticker_bucket_uidx
  ON public.ev_decision_log (ticker, snapshot_bucket);

CREATE INDEX IF NOT EXISTS ev_decision_log_close_time_idx
  ON public.ev_decision_log (close_time DESC);
CREATE INDEX IF NOT EXISTS ev_decision_log_would_fire_idx
  ON public.ev_decision_log (would_fire) WHERE would_fire = true;

GRANT SELECT ON public.ev_decision_log TO authenticated;
GRANT ALL ON public.ev_decision_log TO service_role;

ALTER TABLE public.ev_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ev_decision_log authenticated read"
  ON public.ev_decision_log
  FOR SELECT
  TO authenticated
  USING (true);
