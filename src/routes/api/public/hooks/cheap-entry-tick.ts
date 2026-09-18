// pg_cron driver for the Cheap Entry Auto-Bet (paper).
// Scans open BTC 15m windows, buys the target side when Kalshi's ask is inside
// the 20-65c band, and settles due cheap_entry paper fills. Paper only.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/cheap-entry-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { driveCheapEntry } = await import("@/lib/cheapEntryAutoBet.server");
          const res = await driveCheapEntry();
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
