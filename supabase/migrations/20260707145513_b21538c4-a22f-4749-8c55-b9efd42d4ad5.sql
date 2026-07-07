
ALTER TABLE public.auto_trade_flip_shadow
  ADD COLUMN IF NOT EXISTS t45_loss_avoided numeric,
  ADD COLUMN IF NOT EXISTS t45_profit_given_up numeric,
  ADD COLUMN IF NOT EXISTS t45_minutes_remaining numeric,
  ADD COLUMN IF NOT EXISTS t45_recovered_to_tp boolean,

  ADD COLUMN IF NOT EXISTS t40_loss_avoided numeric,
  ADD COLUMN IF NOT EXISTS t40_profit_given_up numeric,
  ADD COLUMN IF NOT EXISTS t40_minutes_remaining numeric,
  ADD COLUMN IF NOT EXISTS t40_recovered_to_tp boolean,

  ADD COLUMN IF NOT EXISTS t35_loss_avoided numeric,
  ADD COLUMN IF NOT EXISTS t35_profit_given_up numeric,
  ADD COLUMN IF NOT EXISTS t35_minutes_remaining numeric,
  ADD COLUMN IF NOT EXISTS t35_recovered_to_tp boolean,

  ADD COLUMN IF NOT EXISTS t30_loss_avoided numeric,
  ADD COLUMN IF NOT EXISTS t30_profit_given_up numeric,
  ADD COLUMN IF NOT EXISTS t30_minutes_remaining numeric,
  ADD COLUMN IF NOT EXISTS t30_recovered_to_tp boolean;
