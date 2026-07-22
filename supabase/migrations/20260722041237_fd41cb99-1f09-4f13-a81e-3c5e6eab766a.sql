ALTER TABLE public.paper_balances ALTER COLUMN balance_cents SET DEFAULT 50000;
ALTER TABLE public.paper_balances ALTER COLUMN starting_cents SET DEFAULT 50000;
UPDATE public.paper_balances
SET balance_cents = balance_cents + 40000,
    starting_cents = 50000,
    bankrupt_at = NULL
WHERE starting_cents = 10000;