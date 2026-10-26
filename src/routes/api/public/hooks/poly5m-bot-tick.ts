// pg_cron driver for the 5m Polymarket paper bot. Paper money only.
// Each call runs up to 4 passes ~2s apart.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/poly5m-bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { runPoly5mBotTick } = await import("@/lib/poly5mBot/poly5mBot.server");
          const out: unknown[] = [];
          for (let i = 0; i < 4; i++) {
            out.push(await runPoly5mBotTick());
            if (i < 3) await new Promise((r) => setTimeout(r, 2000));
          }
          return Response.json({ ok: true, passes: out });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
