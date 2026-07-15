
ALTER TABLE public.auto_odds_settings
  ADD COLUMN IF NOT EXISTS exit_tp_frac numeric NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS exit_sl_frac numeric NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS exit_late_sl_frac numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS exit_edge_decay_cents integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS exit_flip_prob numeric NOT NULL DEFAULT 0.45,
  ADD COLUMN IF NOT EXISTS exit_odds_flip_cents integer NOT NULL DEFAULT 12;
