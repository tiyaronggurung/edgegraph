// pg_cron driver for the Paper Desk two-sided bot. PAPER ONLY, isolated pb_* tables.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/paper-bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { runPaperBotTick } = await import("@/lib/paperBot/paperBot.server");
          const res = await runPaperBotTick();
          return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json" } });
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
