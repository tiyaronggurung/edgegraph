// pg_cron driver for the 5m Polymarket paper bot. Paper money only.
// Each call runs ~1 pass per second for ~8.5s.
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
          // ~1 pass per second across the 10s cron slot (stop by ~8.5s to avoid overlap).
          const t0 = Date.now();
          for (let i = 0; i < 9 && Date.now() - t0 < 8500; i++) {
            const ps = Date.now();
            out.push(await runPoly5mBotTick().catch((e) => ({ ok: false, error: String(e?.message ?? e) })));
            const wait = 1000 - (Date.now() - ps);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          }
          return Response.json({ ok: true, passes: out });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
