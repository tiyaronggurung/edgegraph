CREATE TABLE public.paper_kalshi_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  position_id UUID REFERENCES public.paper_kalshi_positions(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL,
  side TEXT,
  contracts INTEGER,
  price_cents INTEGER,
  cash_cents INTEGER,
  pnl_cents INTEGER,
  spot NUMERIC,
  strike NUMERIC,
  seconds_left INTEGER,
  note TEXT,
  auto BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_kalshi_events TO authenticated;
GRANT ALL ON public.paper_kalshi_events TO service_role;

ALTER TABLE public.paper_kalshi_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own paper events"
  ON public.paper_kalshi_events FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_paper_kalshi_events_user_time
  ON public.paper_kalshi_events (user_id, created_at DESC);

ALTER TABLE public.paper_kalshi_positions
  ADD COLUMN IF NOT EXISTS auto_hedge BOOLEAN NOT NULL DEFAULT true;