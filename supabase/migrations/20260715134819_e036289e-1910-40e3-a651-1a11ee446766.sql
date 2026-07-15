
-- 1) Restrict formerly-public tables to authenticated users only
DROP POLICY IF EXISTS "live_predictions public read" ON public.live_predictions;
CREATE POLICY "live_predictions authenticated read" ON public.live_predictions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "patterns public read" ON public.patterns;
CREATE POLICY "patterns authenticated read" ON public.patterns
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "prediction_closes public read" ON public.prediction_closes;
CREATE POLICY "prediction_closes authenticated read" ON public.prediction_closes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "prediction_history public read" ON public.prediction_history;
CREATE POLICY "prediction_history authenticated read" ON public.prediction_history
  FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.live_predictions FROM anon;
REVOKE SELECT ON public.patterns FROM anon;
REVOKE SELECT ON public.prediction_closes FROM anon;
REVOKE SELECT ON public.prediction_history FROM anon;

-- 2) btc_market_intel: allow authenticated users to read system-shared rows (user_id IS NULL)
CREATE POLICY "Users read shared market intel" ON public.btc_market_intel
  FOR SELECT TO authenticated USING (user_id IS NULL);
