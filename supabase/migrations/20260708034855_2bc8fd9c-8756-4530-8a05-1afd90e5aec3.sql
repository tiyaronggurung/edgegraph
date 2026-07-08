
CREATE TABLE public.auto_trade_odds_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  strike numeric NOT NULL,
  side text NOT NULL CHECK (side IN ('YES','NO')),
  trigger text NOT NULL CHECK (trigger IN ('leader_chase','flip_fade')),
  fired_at timestamptz NOT NULL DEFAULT now(),
  seconds_to_close_at_fire int NOT NULL,
  yes_cents_at_fire int NOT NULL,
  no_cents_at_fire int NOT NULL,
  limit_cents int NOT NULL,
  contracts int NOT NULL,
  stake_usd numeric NOT NULL,
  flip_count_at_fire int NOT NULL,
  spot_at_fire numeric,
  settled boolean NOT NULL DEFAULT false,
  won boolean,
  pnl_usd numeric,
  final_yes_cents int,
  settled_at timestamptz,
  UNIQUE (user_id, ticker)
);
GRANT SELECT, INSERT, UPDATE ON public.auto_trade_odds_shadow TO authenticated;
GRANT ALL ON public.auto_trade_odds_shadow TO service_role;
ALTER TABLE public.auto_trade_odds_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own odds shadow" ON public.auto_trade_odds_shadow
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own odds shadow" ON public.auto_trade_odds_shadow
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own odds shadow" ON public.auto_trade_odds_shadow
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX auto_trade_odds_shadow_user_fired_idx
  ON public.auto_trade_odds_shadow (user_id, fired_at DESC);
