ALTER TABLE public.btc_spot_ticks
  ADD COLUMN IF NOT EXISTS out_of_order boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS btc_spot_ticks_out_of_order_idx
  ON public.btc_spot_ticks (source, observed_at DESC)
  WHERE out_of_order = true;