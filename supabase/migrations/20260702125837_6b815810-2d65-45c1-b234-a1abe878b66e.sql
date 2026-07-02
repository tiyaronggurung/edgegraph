
ALTER TABLE public.auto_odds_tracked_orders
  ADD COLUMN IF NOT EXISTS oscillation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_zone text;
