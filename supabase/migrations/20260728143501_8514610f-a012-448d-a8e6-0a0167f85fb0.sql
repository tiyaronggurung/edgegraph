-- Revoke public/anon/authenticated EXECUTE on SECURITY DEFINER analytics helpers.
-- These are only invoked from server functions, which will be updated to use
-- the service-role client.
REVOKE EXECUTE ON FUNCTION public.mid_support_study(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trendline_break_study(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mid_support_study(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.trendline_break_study(integer) TO service_role;

-- Replace overly permissive WITH CHECK (true) on odds snapshot insert policy.
DROP POLICY IF EXISTS "Authenticated insert odds snapshots" ON public.btc_kalshi_odds_snapshots;
CREATE POLICY "Authenticated insert odds snapshots"
  ON public.btc_kalshi_odds_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
