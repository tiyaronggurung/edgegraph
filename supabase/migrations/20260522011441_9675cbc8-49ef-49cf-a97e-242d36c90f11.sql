CREATE TABLE public.verdict_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  market_ticker text NOT NULL,
  market_title text,
  side text NOT NULL,
  side_label text,
  fair_prob numeric,
  market_prob numeric,
  edge_pts numeric,
  pattern text,
  kelly_half numeric,
  verdict text NOT NULL DEFAULT 'BET',
  result text NOT NULL DEFAULT 'Pending',
  resolved_at timestamptz
);

ALTER TABLE public.verdict_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own verdict_log all"
  ON public.verdict_log
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_verdict_log_user_created ON public.verdict_log (user_id, created_at DESC);
CREATE INDEX idx_verdict_log_user_market_side ON public.verdict_log (user_id, market_ticker, side);