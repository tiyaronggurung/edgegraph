ALTER TABLE public.auto_odds_settings
  ADD COLUMN IF NOT EXISTS max_entry_cents smallint NOT NULL DEFAULT 78
    CHECK (max_entry_cents BETWEEN 50 AND 95);