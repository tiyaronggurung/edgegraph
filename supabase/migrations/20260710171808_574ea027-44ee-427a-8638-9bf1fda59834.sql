CREATE TABLE public.martingale_recovery_state (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  deficit_usd NUMERIC NOT NULL DEFAULT 0,
  initial_deficit_usd NUMERIC NOT NULL DEFAULT 0,
  recovery_wins_completed INTEGER NOT NULL DEFAULT 0,
  consec_recovery_losses INTEGER NOT NULL DEFAULT 0,
  session_loss_usd NUMERIC NOT NULL DEFAULT 0,
  session_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_reason TEXT,
  last_shadow_id UUID,
  base_stake_usd NUMERIC NOT NULL DEFAULT 50,
  max_stake_usd NUMERIC NOT NULL DEFAULT 150,
  accepted_deficit_usd NUMERIC NOT NULL DEFAULT 15,
  session_loss_cap_usd NUMERIC NOT NULL DEFAULT 200,
  max_consec_recovery_losses INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.martingale_recovery_state TO authenticated;
GRANT ALL ON public.martingale_recovery_state TO service_role;

ALTER TABLE public.martingale_recovery_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own recovery state"
  ON public.martingale_recovery_state
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_martingale_recovery_state_updated_at
  BEFORE UPDATE ON public.martingale_recovery_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();