REVOKE EXECUTE ON FUNCTION public.prune_btc_candles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_btc_candles() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_btc_candles() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_btc_candles() TO service_role;