ALTER TABLE public.paper_fills DROP CONSTRAINT paper_fills_button_check;
ALTER TABLE public.paper_fills ADD CONSTRAINT paper_fills_button_check
  CHECK (button = ANY (ARRAY['model','pred','green_hours','manual','t5m','cheap_flip']));

ALTER TABLE public.big_flip_signals
  ADD COLUMN IF NOT EXISTS trigger_kind text NOT NULL DEFAULT 'big_flip_25c',
  ADD COLUMN IF NOT EXISTS min_ask_cents integer,
  ADD COLUMN IF NOT EXISTS model_side_conf numeric,
  ADD COLUMN IF NOT EXISTS paper_fill_id uuid;

CREATE INDEX IF NOT EXISTS big_flip_signals_trigger_idx
  ON public.big_flip_signals (user_id, trigger_kind, detected_at DESC);