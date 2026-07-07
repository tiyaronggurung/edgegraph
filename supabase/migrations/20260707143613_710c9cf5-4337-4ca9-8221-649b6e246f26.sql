
CREATE TABLE public.auto_trade_flip_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE,
  ticker text NOT NULL,
  side text NOT NULL,
  entry_cents integer NOT NULL,
  contracts integer NOT NULL,
  placed_at timestamptz NOT NULL,
  settled_at timestamptz,
  actual_outcome text,
  actual_pnl numeric,
  min_mark_seen integer,
  tape_samples integer NOT NULL DEFAULT 0,

  t45_first_cross_mark integer,
  t45_first_cross_secs integer,
  t45_sim_exit_cents integer,
  t45_sim_pnl numeric,
  t45_saved_loss boolean,
  t45_killed_winner boolean,

  t40_first_cross_mark integer,
  t40_first_cross_secs integer,
  t40_sim_exit_cents integer,
  t40_sim_pnl numeric,
  t40_saved_loss boolean,
  t40_killed_winner boolean,

  t35_first_cross_mark integer,
  t35_first_cross_secs integer,
  t35_sim_exit_cents integer,
  t35_sim_pnl numeric,
  t35_saved_loss boolean,
  t35_killed_winner boolean,

  t30_first_cross_mark integer,
  t30_first_cross_secs integer,
  t30_sim_exit_cents integer,
  t30_sim_pnl numeric,
  t30_saved_loss boolean,
  t30_killed_winner boolean,

  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auto_trade_flip_shadow_user_settled_idx
  ON public.auto_trade_flip_shadow (user_id, settled_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_trade_flip_shadow TO authenticated;
GRANT ALL ON public.auto_trade_flip_shadow TO service_role;

ALTER TABLE public.auto_trade_flip_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own flip shadow rows"
  ON public.auto_trade_flip_shadow FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.auto_odds_settings
  ADD COLUMN IF NOT EXISTS shadow_flip_enabled boolean NOT NULL DEFAULT true;
