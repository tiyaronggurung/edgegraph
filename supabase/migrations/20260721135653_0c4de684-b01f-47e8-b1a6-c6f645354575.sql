
CREATE TABLE public.pred_locks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,
  ask NUMERIC,
  edge NUMERIC,
  side_conf NUMERIC,
  spot NUMERIC,
  strike NUMERIC,
  time_left_sec INTEGER,
  v1_fired BOOLEAN NOT NULL DEFAULT false,
  v2_action TEXT,
  v2_side TEXT,
  v2_reason TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_start, ticker)
);

CREATE INDEX idx_pred_locks_window ON public.pred_locks (window_start DESC);
CREATE INDEX idx_pred_locks_user_window ON public.pred_locks (user_id, window_start DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pred_locks TO authenticated;
GRANT ALL ON public.pred_locks TO service_role;

ALTER TABLE public.pred_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own pred locks"
  ON public.pred_locks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own pred locks"
  ON public.pred_locks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own pred locks"
  ON public.pred_locks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_pred_locks_updated_at
  BEFORE UPDATE ON public.pred_locks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
