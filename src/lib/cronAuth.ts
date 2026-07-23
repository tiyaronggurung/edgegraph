// Shared authentication for public cron/automation endpoints.
// pg_cron (and any external scheduler) MUST send:
//   x-cron-secret: <CRON_SECRET>
// Server-only env var; never exposed to the client bundle.
export function verifyCronRequest(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return new Response("CRON_SECRET not configured", { status: 503 });
  }
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("X-Cron-Secret");
  if (!provided || provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
