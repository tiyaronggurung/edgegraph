ALTER TABLE public.p5_settings ADD COLUMN IF NOT EXISTS live_stake numeric NOT NULL DEFAULT 10;

CREATE OR REPLACE FUNCTION public.p5_set_live_stake(p_stake numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT is_ops_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_stake IS NULL OR p_stake < 1 OR p_stake > 1000 THEN RAISE EXCEPTION 'stake must be 1–1000'; END IF;
  UPDATE p5_settings SET live_stake = p_stake, updated_at = now() WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION public.p5_set_live_stake(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p5_set_live_stake(numeric) TO authenticated;