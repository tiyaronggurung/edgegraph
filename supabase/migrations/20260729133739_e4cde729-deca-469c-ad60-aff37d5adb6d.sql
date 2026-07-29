
ALTER TABLE public.btc_gate_config
  ADD COLUMN IF NOT EXISTS skip_guard_mode text NOT NULL DEFAULT 'shadow'
    CHECK (skip_guard_mode IN ('off','shadow','enforced')),
  ADD COLUMN IF NOT EXISTS skip_guard_cushion_soft_usd numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS skip_guard_cushion_hard_usd numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS skip_guard_min_conf_tight numeric NOT NULL DEFAULT 0.82;

ALTER TABLE public.btc_model_predictions
  ADD COLUMN IF NOT EXISTS skip_guard_verdict text,
  ADD COLUMN IF NOT EXISTS skip_guard_reason text,
  ADD COLUMN IF NOT EXISTS skip_guard_cushion_usd numeric;
