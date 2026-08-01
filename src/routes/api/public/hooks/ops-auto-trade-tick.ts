// Ops Manual auto-trader tick (REAL MONEY). Driven by pg_cron every 30s.
// All rule enforcement lives in src/lib/opsManual/opsAutoTrade.server.ts.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/ops-auto-trade-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;
        try {
          const { driveOpsAutoTrade } = await import("@/lib/opsManual/opsAutoTrade.server");
          const out = await driveOpsAutoTrade();
          return Response.json({ ok: true, ...out });
        } catch (e) {
          console.error("ops-auto-trade-tick failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
