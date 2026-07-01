UPDATE public.auto_trade_orders
SET status = 'cancelled',
    contracts_remaining = 0,
    partial_pnl_usd = 0,
    pnl_usd = 0,
    error_message = COALESCE(error_message, '') || ' [reconciled: IOC 0-fill @ 47¢ — no position taken]',
    settled_at = now()
WHERE id = 'a09e7d7f-b74b-4870-b97b-1bd0a9d11bb2'
  AND status = 'placed';