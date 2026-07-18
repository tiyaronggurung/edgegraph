ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS settle_spike_z_at_fire numeric,
  ADD COLUMN IF NOT EXISTS settle_spike_would_skip boolean NOT NULL DEFAULT false;