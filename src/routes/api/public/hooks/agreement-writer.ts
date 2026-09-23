// pg_cron driver for the server-side 4/4 agreement recorder.
// Keeps the signal recording when no browser is open. Places no bet.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/agreement-writer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { recordAgreementFromServer } = await import("@/lib/agreementRecorder.server");
          const res = await recordAgreementFromServer();
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
