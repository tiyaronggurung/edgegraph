
REVOKE EXECUTE ON FUNCTION public.run_loss_autopsy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_loss_autopsy() TO service_role;
