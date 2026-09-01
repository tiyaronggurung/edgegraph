CREATE TABLE public.paper_kalshi_account (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  starting_cents bigint NOT NULL DEFAULT 1000000,
  cash_cents bigint NOT NULL DEFAULT 1000000,
  auto_buy boolean NOT NULL DEFAULT false,
  auto_buy_contracts integer NOT NULL DEFAULT 10,
  auto_buy_max_ask_cents integer NOT NULL DEFAULT 70,
  auto_buy_min_conf numeric NOT NULL DEFAULT 0.75,
  auto_buy_min_cushion_usd numeric NOT NULL DEFAULT 40,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_kalshi_account TO authenticated;
GRANT ALL ON public.paper_kalshi_account TO service_role;

ALTER TABLE public.paper_kalshi_account ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own paper kalshi account"
ON public.paper_kalshi_account FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER paper_kalshi_account_updated_at
BEFORE UPDATE ON public.paper_kalshi_account
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();