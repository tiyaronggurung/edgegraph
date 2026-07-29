ALTER TABLE public.btc_kalshi_odds_snapshots
  ADD COLUMN IF NOT EXISTS spot_buy_vol_1m numeric,
  ADD COLUMN IF NOT EXISTS spot_sell_vol_1m numeric,
  ADD COLUMN IF NOT EXISTS spot_vol_imb_1m numeric,
  ADD COLUMN IF NOT EXISTS spot_buy_vol_win numeric,
  ADD COLUMN IF NOT EXISTS spot_sell_vol_win numeric,
  ADD COLUMN IF NOT EXISTS spot_vol_imb_win numeric;