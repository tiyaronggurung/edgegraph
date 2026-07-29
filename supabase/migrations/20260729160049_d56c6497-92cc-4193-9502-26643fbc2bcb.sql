ALTER TABLE public.btc_gate_config
  ADD COLUMN IF NOT EXISTS max_ask_mode text NOT NULL DEFAULT 'shadow',
  ADD COLUMN IF NOT EXISTS max_ask_cents integer NOT NULL DEFAULT 85;