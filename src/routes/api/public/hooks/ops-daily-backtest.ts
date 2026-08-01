// Daily Operating-Manual backtest. Driven by pg_cron once per day, after the
// prior day's windows have settled. Read-only against btc_model_predictions;
// writes one immutable row into ops_backtest_runs.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { runOpsBacktest } from "@/lib/opsManual/opsManual.server";

export const Route = createFileRoute("/api/public/hooks/ops-daily-backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const out = await runOpsBacktest(supabaseAdmin);
          const { error } = await supabaseAdmin.from("ops_backtest_runs").insert({
            user_id: null,
            through_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
            status: out.status,
            rolling30_wr: out.rolling30Wr,
            rolling100_wr: out.rolling100Wr,
            max_drawdown_pct: out.maxDrawdownPct,
            results: JSON.parse(JSON.stringify(out)),
          });
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          return Response.json({
            ok: true,
            status: out.status,
            qualifiedWindows: out.qualifiedWindows,
            totalWindows: out.totalWindows,
            rolling30Wr: out.rolling30Wr,
          });
        } catch (e) {
          console.error("ops-daily-backtest failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
