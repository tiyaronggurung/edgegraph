-- Admin check helper (security definer, avoids recursive RLS on profiles)
CREATE OR REPLACE FUNCTION public.is_ops_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = _user_id), false)
$$;

-- 1. Daily bankroll / staking snapshots
CREATE TABLE public.ops_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_date date NOT NULL,
  morning_bankroll numeric NOT NULL,
  all_time_high_bankroll numeric NOT NULL DEFAULT 0,
  unit_pct numeric NOT NULL DEFAULT 0.10,
  unit_usd numeric NOT NULL DEFAULT 0,
  staking_mode text NOT NULL DEFAULT 'standard',
  mode_reason text,
  bets_placed integer NOT NULL DEFAULT 0,
  consecutive_losses integer NOT NULL DEFAULT 0,
  daily_pnl numeric NOT NULL DEFAULT 0,
  closing_bankroll numeric,
  stopped boolean NOT NULL DEFAULT false,
  stop_reason text,
  review_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_date)
);

-- 2. Logged trades
CREATE TABLE public.ops_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_date date NOT NULL,
  ticker text NOT NULL,
  decision_at timestamptz NOT NULL DEFAULT now(),
  utc_hour integer,
  strike numeric,
  side text,
  study_side text,
  study_conf numeric,
  model_side text,
  model_conf numeric,
  spot_at_lock numeric,
  cushion_usd numeric,
  ask_cents integer,
  seconds_left integer,
  stake numeric NOT NULL DEFAULT 0,
  potential_profit numeric,
  result text,
  realized_pnl numeric,
  bankroll_after numeric,
  rule_status text NOT NULL DEFAULT 'compliant',
  violations text[] NOT NULL DEFAULT '{}',
  discipline_score integer NOT NULL DEFAULT 100,
  notes text,
  decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Window evaluations (filter audit)
CREATE TABLE public.ops_window_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  ticker text NOT NULL,
  close_time timestamptz,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  qualified boolean NOT NULL DEFAULT false,
  fail_reasons text[] NOT NULL DEFAULT '{}',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Alerts
CREATE TABLE public.ops_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  level text NOT NULL,
  code text NOT NULL,
  metric text,
  current_value numeric,
  threshold_value numeric,
  action_taken text,
  resume_conditions text,
  manual_review_required boolean NOT NULL DEFAULT false,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Rule violations
CREATE TABLE public.ops_rule_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_date date NOT NULL,
  rule_code text NOT NULL,
  description text,
  trade_id uuid REFERENCES public.ops_trades(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Staking mode changes
CREATE TABLE public.ops_mode_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  from_mode text,
  to_mode text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Withdrawal milestones
CREATE TABLE public.ops_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  milestone_from numeric NOT NULL,
  milestone_to numeric NOT NULL,
  required_amount numeric NOT NULL,
  withdrawn_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone_to)
);

-- 8. Backtest runs
CREATE TABLE public.ops_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  run_at timestamptz NOT NULL DEFAULT now(),
  through_date date,
  status text NOT NULL DEFAULT 'healthy',
  rolling30_wr numeric,
  rolling100_wr numeric,
  max_drawdown_pct numeric,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. Threshold change history
CREATE TABLE public.ops_threshold_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  threshold_key text NOT NULL,
  previous_value text,
  new_value text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_daily_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_trades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_window_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_rule_violations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_mode_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_withdrawals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_backtest_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_threshold_changes TO authenticated;
GRANT ALL ON public.ops_daily_snapshots TO service_role;
GRANT ALL ON public.ops_trades TO service_role;
GRANT ALL ON public.ops_window_evaluations TO service_role;
GRANT ALL ON public.ops_alerts TO service_role;
GRANT ALL ON public.ops_rule_violations TO service_role;
GRANT ALL ON public.ops_mode_changes TO service_role;
GRANT ALL ON public.ops_withdrawals TO service_role;
GRANT ALL ON public.ops_backtest_runs TO service_role;
GRANT ALL ON public.ops_threshold_changes TO service_role;

-- RLS
ALTER TABLE public.ops_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_window_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_rule_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_mode_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_threshold_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_daily_snapshots_admin_own" ON public.ops_daily_snapshots FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id)
  WITH CHECK (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id);
CREATE POLICY "ops_trades_admin_own" ON public.ops_trades FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id)
  WITH CHECK (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id);
CREATE POLICY "ops_window_evaluations_admin" ON public.ops_window_evaluations FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()))
  WITH CHECK (public.is_ops_admin(auth.uid()));
CREATE POLICY "ops_alerts_admin_own" ON public.ops_alerts FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id)
  WITH CHECK (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id);
CREATE POLICY "ops_rule_violations_admin_own" ON public.ops_rule_violations FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id)
  WITH CHECK (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id);
CREATE POLICY "ops_mode_changes_admin_own" ON public.ops_mode_changes FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id)
  WITH CHECK (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id);
CREATE POLICY "ops_withdrawals_admin_own" ON public.ops_withdrawals FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id)
  WITH CHECK (public.is_ops_admin(auth.uid()) AND auth.uid() = user_id);
CREATE POLICY "ops_backtest_runs_admin" ON public.ops_backtest_runs FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()))
  WITH CHECK (public.is_ops_admin(auth.uid()));
CREATE POLICY "ops_threshold_changes_admin" ON public.ops_threshold_changes FOR ALL TO authenticated
  USING (public.is_ops_admin(auth.uid()))
  WITH CHECK (public.is_ops_admin(auth.uid()));

-- updated_at triggers
CREATE TRIGGER ops_daily_snapshots_updated_at BEFORE UPDATE ON public.ops_daily_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER ops_trades_updated_at BEFORE UPDATE ON public.ops_trades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER ops_withdrawals_updated_at BEFORE UPDATE ON public.ops_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX ops_trades_user_date_idx ON public.ops_trades (user_id, session_date DESC);
CREATE INDEX ops_trades_user_decision_idx ON public.ops_trades (user_id, decision_at DESC);
CREATE INDEX ops_window_eval_ticker_idx ON public.ops_window_evaluations (ticker);
CREATE INDEX ops_alerts_user_idx ON public.ops_alerts (user_id, triggered_at DESC);