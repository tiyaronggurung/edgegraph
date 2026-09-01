-- 1. Per-user ops tables: own-row access for any authenticated user
DROP POLICY IF EXISTS ops_trades_admin_own ON public.ops_trades;
CREATE POLICY ops_trades_own ON public.ops_trades FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ops_alerts_admin_own ON public.ops_alerts;
CREATE POLICY ops_alerts_own ON public.ops_alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ops_daily_snapshots_admin_own ON public.ops_daily_snapshots;
CREATE POLICY ops_daily_snapshots_own ON public.ops_daily_snapshots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ops_mode_changes_admin_own ON public.ops_mode_changes;
CREATE POLICY ops_mode_changes_own ON public.ops_mode_changes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ops_rule_violations_admin_own ON public.ops_rule_violations;
CREATE POLICY ops_rule_violations_own ON public.ops_rule_violations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ops_withdrawals_admin_own ON public.ops_withdrawals;
CREATE POLICY ops_withdrawals_own ON public.ops_withdrawals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ops_backtest_runs_admin ON public.ops_backtest_runs;
CREATE POLICY ops_backtest_runs_read ON public.ops_backtest_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY ops_backtest_runs_own_write ON public.ops_backtest_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Shared reference tables: readable by all, writable by admins only
CREATE POLICY ops_threshold_changes_read ON public.ops_threshold_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY ops_window_evaluations_read ON public.ops_window_evaluations FOR SELECT TO authenticated USING (true);

-- 3. Paper Kalshi positions
CREATE TABLE public.paper_kalshi_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  strike NUMERIC,
  entry_side TEXT NOT NULL CHECK (entry_side IN ('YES','NO')),
  entry_contracts INTEGER NOT NULL CHECK (entry_contracts > 0),
  entry_price_cents INTEGER NOT NULL CHECK (entry_price_cents BETWEEN 1 AND 99),
  entry_spot NUMERIC,
  entry_seconds_left INTEGER,
  entry_reason TEXT,
  hedge_side TEXT CHECK (hedge_side IN ('YES','NO')),
  hedge_contracts INTEGER,
  hedge_price_cents INTEGER,
  hedged_at TIMESTAMPTZ,
  exit_price_cents INTEGER,
  exit_contracts INTEGER,
  exited_at TIMESTAMPTZ,
  exit_reason TEXT,
  crossed_strike BOOLEAN NOT NULL DEFAULT false,
  crossed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','hedged','closed','settled','void')),
  outcome TEXT CHECK (outcome IN ('YES','NO')),
  pnl_cents INTEGER,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_kalshi_positions TO authenticated;
GRANT ALL ON public.paper_kalshi_positions TO service_role;

ALTER TABLE public.paper_kalshi_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY paper_kalshi_positions_own ON public.paper_kalshi_positions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX paper_kalshi_positions_user_created_idx ON public.paper_kalshi_positions (user_id, created_at DESC);
CREATE INDEX paper_kalshi_positions_open_idx ON public.paper_kalshi_positions (status, close_time) WHERE status IN ('open','hedged');

CREATE TRIGGER paper_kalshi_positions_updated_at
  BEFORE UPDATE ON public.paper_kalshi_positions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();