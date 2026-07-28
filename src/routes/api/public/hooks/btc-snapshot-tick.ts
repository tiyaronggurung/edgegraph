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
        try {
          const { computeBtcMarkets } = await import("@/lib/cryptoBtc.functions");
          const res = await computeBtcMarkets();
          return new Response(
            JSON.stringify({ ok: true, markets: res?.markets?.length ?? 0 }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
