ALTER TABLE public.auto_trade_orders
  ADD COLUMN IF NOT EXISTS entry_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS contracts_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS partial_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exit_ladder JSONB;

-- Backfill open live rows so the new logic can act on them immediately.
UPDATE public.auto_trade_orders
   SET entry_price_cents = limit_cents,
       contracts_remaining = contracts
 WHERE status = 'placed'
   AND (entry_price_cents IS NULL OR contracts_remaining IS NULL);