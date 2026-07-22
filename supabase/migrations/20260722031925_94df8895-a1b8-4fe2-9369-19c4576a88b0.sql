
-- 1. paper_balances
CREATE TABLE public.paper_balances (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cents integer NOT NULL DEFAULT 10000,
  starting_cents integer NOT NULL DEFAULT 10000,
  bankrupt_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.paper_balances TO authenticated;
GRANT ALL ON public.paper_balances TO service_role;

ALTER TABLE public.paper_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own paper balance"
  ON public.paper_balances FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER paper_balances_updated_at
  BEFORE UPDATE ON public.paper_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. paper_fills
CREATE TABLE public.paper_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  close_time timestamptz NOT NULL,
  button text NOT NULL CHECK (button IN ('model','pred','green_hours')),
  side text NOT NULL CHECK (side IN ('YES','NO')),
  contracts integer NOT NULL CHECK (contracts > 0),
  fill_price_cents integer NOT NULL CHECK (fill_price_cents BETWEEN 1 AND 100),
  stake_cents integer NOT NULL DEFAULT 1000,
  entry_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','void')),
  payout_cents integer NULL,
  pnl_cents integer NULL,
  settled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paper_fills_user_created_idx ON public.paper_fills (user_id, created_at DESC);
CREATE INDEX paper_fills_open_idx ON public.paper_fills (status, close_time) WHERE status = 'open';
CREATE INDEX paper_fills_user_button_idx ON public.paper_fills (user_id, button, status);

GRANT SELECT ON public.paper_fills TO authenticated;
GRANT ALL ON public.paper_fills TO service_role;

ALTER TABLE public.paper_fills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own paper fills"
  ON public.paper_fills FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER paper_fills_updated_at
  BEFORE UPDATE ON public.paper_fills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Seed on signup — extend existing handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.paper_balances (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

-- 4. Backfill existing users
INSERT INTO public.paper_balances (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
