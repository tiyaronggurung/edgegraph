// pg_cron driver for the Quad-Confirmation paper engine. Paper money only.
// Each call runs up to 4 passes ~2s apart so reaction time is ~2s, not 10s.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/quad-bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { runQuadBotTick } = await import("@/lib/quadBot/quadBot.server");
          const out: any[] = [];
          for (let i = 0; i < 4; i++) {
            const r = await runQuadBotTick();
            out.push(r);
            if ((r as any).skipped) break;
            if (i < 3) await new Promise((res) => setTimeout(res, 2000));
          }
          return Response.json({ ok: true, passes: out });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
