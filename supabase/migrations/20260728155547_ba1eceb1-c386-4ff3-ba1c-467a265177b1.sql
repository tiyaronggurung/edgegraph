
ALTER TABLE public.btc_kalshi_odds_snapshots
  ADD COLUMN IF NOT EXISTS kalshi_volume BIGINT,
  ADD COLUMN IF NOT EXISTS kalshi_open_interest BIGINT,
  ADD COLUMN IF NOT EXISTS kalshi_last_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS kalshi_yes_vol_60s INTEGER,
  ADD COLUMN IF NOT EXISTS kalshi_no_vol_60s INTEGER,
  ADD COLUMN IF NOT EXISTS kalshi_trade_count_60s INTEGER;

COMMENT ON COLUMN public.btc_kalshi_odds_snapshots.kalshi_volume IS 'Cumulative market volume (contracts traded lifetime)';
COMMENT ON COLUMN public.btc_kalshi_odds_snapshots.kalshi_yes_vol_60s IS 'YES taker-side contracts traded in last 60s';
COMMENT ON COLUMN public.btc_kalshi_odds_snapshots.kalshi_no_vol_60s IS 'NO taker-side contracts traded in last 60s';
