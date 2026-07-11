
CREATE TABLE public.big_flip_killswitch (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  halted boolean NOT NULL DEFAULT false,
  halted_at timestamptz,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.big_flip_killswitch TO authenticated;
GRANT ALL ON public.big_flip_killswitch TO service_role;
ALTER TABLE public.big_flip_killswitch ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own killswitch" ON public.big_flip_killswitch
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
