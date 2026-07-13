
-- btc_polymarket_triple_window: remove open write policies (service role bypasses RLS)
DROP POLICY IF EXISTS "Authenticated can insert triple window" ON public.btc_polymarket_triple_window;
DROP POLICY IF EXISTS "Authenticated can update triple window" ON public.btc_polymarket_triple_window;

-- upgrade_events: narrow read policy to own rows only
DROP POLICY IF EXISTS "own upgrade events read" ON public.upgrade_events;
CREATE POLICY "own upgrade events read" ON public.upgrade_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- storage graph-uploads update: add matching WITH CHECK
DROP POLICY IF EXISTS "graph uploads own update" ON storage.objects;
CREATE POLICY "graph uploads own update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'graph-uploads' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'graph-uploads' AND (auth.uid())::text = (storage.foldername(name))[1]);
