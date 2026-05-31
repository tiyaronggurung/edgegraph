
-- Add alert preference columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alert_frequency text NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS alert_sport_filters text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alert_min_confidence numeric NOT NULL DEFAULT 0;

-- Validate alert_frequency values via trigger (not CHECK, per stack rules allowing flexibility)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_alert_frequency_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_alert_frequency_chk
  CHECK (alert_frequency IN ('instant', 'daily_digest', 'off'));
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_alert_min_confidence_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_alert_min_confidence_chk
  CHECK (alert_min_confidence >= 0 AND alert_min_confidence <= 100);

-- Pending digest queue (one row per qualifying BET alert, dedupe per user+market+side+date)
CREATE TABLE IF NOT EXISTS public.pending_digest_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  market_ticker text NOT NULL,
  market_title text,
  side text NOT NULL,
  side_label text,
  fair_prob numeric,
  market_prob numeric,
  edge_pts numeric,
  pattern text,
  kelly_half numeric,
  sport text,
  alert_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_digest_alerts_dedupe
  ON public.pending_digest_alerts (user_id, market_ticker, side, alert_date);

CREATE INDEX IF NOT EXISTS pending_digest_alerts_unsent
  ON public.pending_digest_alerts (user_id, sent, created_at)
  WHERE sent = false;

GRANT SELECT, INSERT, UPDATE ON public.pending_digest_alerts TO authenticated;
GRANT ALL ON public.pending_digest_alerts TO service_role;

ALTER TABLE public.pending_digest_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own digest alerts read"
  ON public.pending_digest_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own digest alerts insert"
  ON public.pending_digest_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
