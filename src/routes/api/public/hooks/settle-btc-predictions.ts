import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

// Public cron endpoint: settles any BTC model predictions whose close_time has
// passed. Called by pg_cron every minute so rows don't linger on "pending".
export const Route = createFileRoute("/api/public/hooks/settle-btc-predictions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        try {
          const { settleDuePredictions } = await import("@/lib/cryptoPredictions.server");
          const res = await settleDuePredictions();
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async ({ request }) => {
        const __cronAuth = verifyCronRequest(request); if (__cronAuth) return __cronAuth;
        try {
          const { settleDuePredictions } = await import("@/lib/cryptoPredictions.server");
          const res = await settleDuePredictions();
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
