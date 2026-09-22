// pg_cron driver for the Verdict Auto-Bet (real money).
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

export const Route = createFileRoute("/api/public/hooks/verdict-bet-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = await verifyCronRequest(request);
        if (authErr) return authErr;
        try {
          const { driveVerdictBet } = await import("@/lib/verdictAutoBet.server");
          const res = await driveVerdictBet();
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
