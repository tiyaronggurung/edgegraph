-- 1) Revoke EXECUTE from PUBLIC/anon/authenticated on internal SECURITY DEFINER functions.
--    These are internal plumbing (email queue, trigger functions) that should
--    never be callable via PostgREST by anon or signed-in users.
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;

-- Keep service_role able to invoke helpers used by edge/cron/webhook paths.
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_wake() TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;

-- 2) Add owner-scoped DELETE policy on auto_odds_settings so the delete path
--    is explicit and can never be widened by an accidental permissive policy.
CREATE POLICY "Users can delete their own auto_odds_settings"
  ON public.auto_odds_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3) profiles kalshi credentials — defense-in-depth.
--    Existing RLS already restricts to the owner. The
--    prevent_profile_privilege_escalation trigger currently only guards
--    admin / subscription / stripe fields. Extend it to also block
--    non-service-role writes from silently overwriting another user's
--    Kalshi credentials via any future permissive UPDATE path.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     OR NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'Not authorized to modify subscription or admin fields';
  END IF;

  -- Kalshi credentials: only the owning user (auth.uid() = id) may change
  -- them. Blocks any future policy widening from letting another signed-in
  -- user overwrite someone else's trading keys.
  IF (NEW.kalshi_private_key_pem IS DISTINCT FROM OLD.kalshi_private_key_pem
      OR NEW.kalshi_api_key_id IS DISTINCT FROM OLD.kalshi_api_key_id)
     AND auth.uid() IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Not authorized to modify Kalshi credentials for another user';
  END IF;

  RETURN NEW;
END;
$function$;

-- Also lock down the trigger function itself from direct API execution.
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;