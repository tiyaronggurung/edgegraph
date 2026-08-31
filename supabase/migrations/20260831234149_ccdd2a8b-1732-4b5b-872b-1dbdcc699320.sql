CREATE TABLE public.btc_cross_exit_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  close_time timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'simulated_t5',
  trade_id uuid REFERENCES public.ops_trades(id) ON DELETE SET NULL,
  entry_side text NOT NULL CHECK (entry_side IN ('YES', 'NO')),
  entry_time timestamptz NOT NULL,
  entry_seconds_to_close integer,
  entry_spot numeric,
  entry_price_cents integer NOT NULL,
  entry_bid_cents integer,
  strike numeric NOT NULL,
  cross_detected boolean NOT NULL DEFAULT false,
  cross_time timestamptz,
  cross_seconds_to_close integer,
  cross_spot numeric,
  cross_cushion_usd numeric,
  exit_bid_cents integer,
  would_exit boolean NOT NULL DEFAULT false,
  exit_reason text,
  flip_side text CHECK (flip_side IS NULL OR flip_side IN ('YES', 'NO')),
  flip_ask_cents integer,
  would_flip boolean NOT NULL DEFAULT false,
  flip_reason text,
  max_flip_ask_cents integer NOT NULL DEFAULT 40,
  flip_time_cutoff_seconds integer NOT NULL DEFAULT 180,
  settled boolean NOT NULL DEFAULT false,
  outcome text CHECK (outcome IS NULL OR outcome IN ('YES', 'NO')),
  hold_pnl_cents integer,
  exit_pnl_cents integer,
  flip_pnl_cents integer,
  combined_pnl_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker, close_time, source, trade_id)
);

GRANT SELECT, INSERT, UPDATE ON public.btc_cross_exit_shadow TO authenticated;
GRANT ALL ON public.btc_cross_exit_shadow TO service_role;

ALTER TABLE public.btc_cross_exit_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cross-exit shadow"
  ON public.btc_cross_exit_shadow FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage cross-exit shadow"
  ON public.btc_cross_exit_shadow FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_btc_cross_exit_ticker_time
  ON public.btc_cross_exit_shadow (ticker, close_time DESC);
CREATE INDEX idx_btc_cross_exit_settled
  ON public.btc_cross_exit_shadow (settled) WHERE settled = false;
CREATE INDEX idx_btc_cross_exit_trade_id
  ON public.btc_cross_exit_shadow (trade_id) WHERE trade_id IS NOT NULL;

CREATE TRIGGER btc_cross_exit_shadow_updated_at BEFORE UPDATE ON public.btc_cross_exit_shadow
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();