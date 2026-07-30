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
          const { snapshotKalshiBook, settleKalshiBook, backfillKalshiBook } = await import(
            "@/lib/kalshiBookLedger.server"
          );
          const { recordTrendlineBook } = await import("@/lib/kalshiBookTrendline.server");
          const snap = await snapshotKalshiBook();
          // Overwrite with the richer full-window tape the trendline chart uses,
          // so the ledger log matches the live COST 15m strip exactly.
          const trend = await recordTrendlineBook();
          const settle = await settleKalshiBook();
          const backfill = await backfillKalshiBook(2);
          return new Response(JSON.stringify({ ok: true, snap, trend, settle, backfill }), {
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
