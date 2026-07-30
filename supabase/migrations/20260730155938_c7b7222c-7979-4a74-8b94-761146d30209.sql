CREATE TABLE public.kalshi_book_ledger (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  window_start timestamptz not null,
  close_time timestamptz,
  strike numeric,
  yes_vol numeric,
  no_vol numeric,
  trade_count integer,
  yes_cost numeric,
  no_cost numeric,
  yes_avg_cents numeric,
  no_avg_cents numeric,
  yes_payout numeric,
  no_payout numeric,
  total_collected numeric,
  house_if_yes numeric,
  house_if_no numeric,
  house_lean text,
  outcome text,
  house_pnl numeric,
  settled_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

CREATE INDEX idx_kalshi_book_ledger_window ON public.kalshi_book_ledger (window_start DESC);
CREATE INDEX idx_kalshi_book_ledger_unsettled ON public.kalshi_book_ledger (close_time) WHERE outcome IS NULL;

GRANT SELECT ON public.kalshi_book_ledger TO authenticated;
GRANT ALL ON public.kalshi_book_ledger TO service_role;

ALTER TABLE public.kalshi_book_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read kalshi book ledger"
ON public.kalshi_book_ledger FOR SELECT TO authenticated USING (true);