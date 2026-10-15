// pg_cron driver for the server-side live odds chart recorder.
// Keeps the odds line + strike recording when no page is open. Places no bet.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/live-odds-writer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { recordLiveOddsFromServer } = await import("@/lib/liveOddsRecorder.server");
          const res = await recordLiveOddsFromServer();
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
