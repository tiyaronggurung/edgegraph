ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cheap_entry_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cheap_entry_stake_cents integer NOT NULL DEFAULT 1000;