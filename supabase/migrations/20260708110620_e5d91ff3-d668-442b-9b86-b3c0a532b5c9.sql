CREATE TABLE public.auto_odds_staking_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  base_stake numeric NOT NULL DEFAULT 100,
  unlock_wins integer NOT NULL DEFAULT 3,
  profit_bank_start_pct numeric NOT NULL DEFAULT 0.25,
  win_growth_pct numeric NOT NULL DEFAULT 0.10,
  loss_reduction_1_pct numeric NOT NULL DEFAULT 0.30,
  loss_reduction_2_pct numeric NOT NULL DEFAULT 0.50,
  max_stake numeric NOT NULL DEFAULT 150,
  max_profit_exposure_pct numeric NOT NULL DEFAULT 0.40,
  max_consecutive_losses integer NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_odds_staking_config TO authenticated;
GRANT ALL ON public.auto_odds_staking_config TO service_role;

ALTER TABLE public.auto_odds_staking_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own staking config"
  ON public.auto_odds_staking_config
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_auto_odds_staking_config_updated_at
  BEFORE UPDATE ON public.auto_odds_staking_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();