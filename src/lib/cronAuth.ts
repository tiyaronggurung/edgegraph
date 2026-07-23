// Shared authentication for public cron/automation endpoints.
// pg_cron sends the header `x-cron-secret: <value>` on every scheduled call.
// The valid value lives in Supabase Vault under name='cron_secret' and is
// read at request time via the security-definer RPC `public._cron_secret()`.
// Fail closed on any error: an unauthenticated caller must never trigger
// the service-role writes these hooks perform.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyCronRequest(request: Request): Promise<Response | null> {
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("X-Cron-Secret");
  if (!provided) return new Response("Unauthorized", { status: 401 });

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("_cron_secret");
    if (error || typeof data !== "string" || !data) {
      console.error("verifyCronRequest: rpc failed", error);
      return new Response("Unauthorized", { status: 401 });
    }
    if (!timingSafeEqual(provided, data)) {
      return new Response("Unauthorized", { status: 401 });
    }
    return null;
  } catch (e) {
    console.error("verifyCronRequest: unexpected error", e);
    return new Response("Unauthorized", { status: 401 });
  }
}
