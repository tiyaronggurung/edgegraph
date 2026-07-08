
ALTER TABLE public.auto_trade_odds_shadow
  ADD COLUMN IF NOT EXISTS rotation_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_shadow_id uuid REFERENCES public.auto_trade_odds_shadow(id) ON DELETE SET NULL;

ALTER TABLE public.auto_trade_odds_shadow
  DROP CONSTRAINT IF EXISTS auto_trade_odds_shadow_user_id_ticker_key;

ALTER TABLE public.auto_trade_odds_shadow
  ADD CONSTRAINT auto_trade_odds_shadow_user_ticker_rot_key
  UNIQUE (user_id, ticker, rotation_index);
