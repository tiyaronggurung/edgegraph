ALTER TABLE public.verdict_log
  ADD COLUMN IF NOT EXISTS bet_id uuid REFERENCES public.bets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS verdict_log_bet_id_idx ON public.verdict_log(bet_id);