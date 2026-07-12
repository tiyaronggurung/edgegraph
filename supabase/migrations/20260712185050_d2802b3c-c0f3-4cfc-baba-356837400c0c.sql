
-- 1) Extend tracked orders with entry snapshot (nullable, backward-compatible)
ALTER TABLE public.auto_odds_tracked_orders
  ADD COLUMN IF NOT EXISTS entry_model_prob NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_ask_cents INTEGER,
  ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ;

-- 2) Shadow table — one row per open-position tick
CREATE TABLE IF NOT EXISTS public.auto_odds_conviction_exit_shadow (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  tick_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seconds_since_entry INTEGER,
  seconds_to_close INTEGER,
  entry_prob NUMERIC,
  current_prob NUMERIC,
  prob_drop NUMERIC,
  entry_ask_cents INTEGER,
  current_bid_cents INTEGER,
  signed_edge_now NUMERIC,
  would_exit_010 BOOLEAN,
  would_exit_015 BOOLEAN,
  would_exit_020 BOOLEAN,
  hypothetical_exit_pnl NUMERIC,
  settled_pnl NUMERIC,
  settled_outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.auto_odds_conviction_exit_shadow TO authenticated;
GRANT ALL ON public.auto_odds_conviction_exit_shadow TO service_role;

ALTER TABLE public.auto_odds_conviction_exit_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own conviction shadow rows"
  ON public.auto_odds_conviction_exit_shadow
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS auto_odds_conviction_exit_shadow_user_created_idx
  ON public.auto_odds_conviction_exit_shadow (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auto_odds_conviction_exit_shadow_order_idx
  ON public.auto_odds_conviction_exit_shadow (order_id);
