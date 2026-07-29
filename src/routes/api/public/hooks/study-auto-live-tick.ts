// pg_cron driver for Study Pick Auto-Bet (real money).
// Fires the same $10 IOC Kalshi buy the client-side retry loop fires — but
// works with the /crypto tab closed. Per-window idempotency lives in the
// shared helper (btc_model_predictions.study_auto_live_fired_at +
// crypto_trades marker), so this is safe to run alongside the open tab.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/study-auto-live-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { driveStudyAutoLive } = await import("@/lib/studyAutoLive.server");
          const res = await driveStudyAutoLive();
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
