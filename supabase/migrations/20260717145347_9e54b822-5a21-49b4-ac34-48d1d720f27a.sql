ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS raw_dir_dwell_at_fire numeric,
  ADD COLUMN IF NOT EXISTS dwell_gate_would_skip boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.auto_trade_orders.raw_dir_dwell_at_fire IS
  'Shadow: fraction of the last 15 one-minute buckets where raw direction (spot vs strike) matched the fired side. Range 0..1.';
COMMENT ON COLUMN public.auto_trade_orders.dwell_gate_would_skip IS
  'Shadow: true when raw_dir_dwell_at_fire < 0.60 (would be blocked once dwell gate is enforced).';