CREATE TABLE public.auto_trade_loss_cap_resets (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reset_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_trade_loss_cap_resets TO authenticated;
GRANT ALL ON public.auto_trade_loss_cap_resets TO service_role;

ALTER TABLE public.auto_trade_loss_cap_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own auto trade loss cap reset"
ON public.auto_trade_loss_cap_resets
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_auto_trade_loss_cap_resets_updated_at
BEFORE UPDATE ON public.auto_trade_loss_cap_resets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();