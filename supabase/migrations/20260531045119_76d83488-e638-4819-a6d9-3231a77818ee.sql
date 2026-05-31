
-- 1. Extend profiles with subscription + admin fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS billing_interval text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free','pro','vip'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_billing_interval_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('month','year'));

-- 2. usage_counters: per-user, per-calendar-month counters
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  bet_alerts_used integer NOT NULL DEFAULT 0,
  ai_verdicts_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own usage read" ON public.usage_counters
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own usage insert" ON public.usage_counters
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own usage update" ON public.usage_counters
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS usage_counters_user_period_idx
  ON public.usage_counters (user_id, period_start DESC);

-- 3. upgrade_events: analytics
CREATE TABLE IF NOT EXISTS public.upgrade_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  event_type text NOT NULL,
  context text,
  target_plan text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.upgrade_events TO authenticated;
GRANT SELECT, INSERT ON public.upgrade_events TO anon;
GRANT ALL ON public.upgrade_events TO service_role;

ALTER TABLE public.upgrade_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can insert upgrade events" ON public.upgrade_events
  FOR INSERT WITH CHECK (true);
CREATE POLICY "own upgrade events read" ON public.upgrade_events
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE INDEX IF NOT EXISTS upgrade_events_user_idx
  ON public.upgrade_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS upgrade_events_type_idx
  ON public.upgrade_events (event_type, created_at DESC);
