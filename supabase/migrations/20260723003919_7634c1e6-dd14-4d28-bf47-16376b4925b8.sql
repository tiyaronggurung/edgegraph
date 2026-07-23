
-- 1) Create/reset a random cron secret in Supabase Vault.
DO $$
DECLARE
  v_id uuid;
  v_val text := encode(gen_random_bytes(32), 'base64');
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'cron_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_val, 'cron_secret', 'Shared secret sent as x-cron-secret header by pg_cron to /api/public/hooks/*');
  ELSE
    PERFORM vault.update_secret(v_id, v_val);
  END IF;
END $$;

-- 2) Helper that produces the x-cron-secret header value at call time.
CREATE OR REPLACE FUNCTION public._cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._cron_secret() FROM PUBLIC, anon, authenticated;

-- 3) Rewrite every HTTP-firing cron.job to include the x-cron-secret header.
--    Non-HTTP jobs (retention deletes, plpgsql-only jobs) are left untouched.
DO $$
DECLARE
  r RECORD;
  base_hdr text := $j${"Content-Type":"application/json","x-cron-secret":"$j$
                    || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1)
                    || $j$"}$j$;
  url text;
  new_cmd text;
BEGIN
  FOR r IN SELECT jobid, jobname, command FROM cron.job WHERE command ILIKE '%net.http_post%' LOOP
    -- Extract the URL literal from the existing command.
    url := (regexp_matches(r.command, $re$url\s*:?=\s*'([^']+)'$re$))[1];
    IF url IS NULL THEN
      CONTINUE;
    END IF;
    new_cmd := format(
      $c$SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 60000) AS request_id;$c$,
      url,
      base_hdr
    );
    PERFORM cron.alter_job(job_id := r.jobid, command := new_cmd);
  END LOOP;
END $$;
