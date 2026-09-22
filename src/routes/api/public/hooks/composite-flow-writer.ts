// pg_cron driver: records composite (Binance + Coinbase) in/out volume, the
// average in/out prices and the verdict for the current 15m window.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/composite-flow-writer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { recordCompositeFlow } = await import("@/lib/compositeFlowRecorder.server");
          const res = await recordCompositeFlow();
          return new Response(JSON.stringify({ ok: true, ...res }), {
            headers: { "Content-Type": "application/json" },
          });
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
