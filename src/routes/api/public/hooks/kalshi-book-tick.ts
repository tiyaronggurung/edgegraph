// Cron-driven: snapshot the current 15m Kalshi window's taker flow / cost
// basis / house P&L, then settle any closed windows.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/kalshi-book-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await verifyCronRequest(request);
        if (auth) return auth;
        try {
          const { snapshotKalshiBook, settleKalshiBook } = await import(
            "@/lib/kalshiBookLedger.server"
          );
          const snap = await snapshotKalshiBook();
          const settle = await settleKalshiBook();
          return new Response(JSON.stringify({ ok: true, snap, settle }), {
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
