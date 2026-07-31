// Cron-driven snapshot: runs computeBtcMarkets() so btc_model_predictions
// keeps filling even when no user has /crypto open.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/btc-snapshot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = await verifyCronRequest(request);
        if (__cronAuth) return __cronAuth;
        // Kalshi 429s used to kill the whole tick, so a window could open with
        // no pending row until minutes later. Retry with backoff before giving up.
        const { computeBtcMarkets } = await import("@/lib/cryptoBtc.functions");
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await computeBtcMarkets();
            return new Response(
              JSON.stringify({ ok: true, markets: res?.markets?.length ?? 0, attempt: attempt + 1 }),
              { headers: { "Content-Type": "application/json" } },
            );
          } catch (e) {
            lastErr = e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
        return new Response(
          JSON.stringify({ ok: false, error: lastErr instanceof Error ? lastErr.message : String(lastErr) }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
