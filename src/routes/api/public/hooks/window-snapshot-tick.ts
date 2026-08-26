// Cron-driven dense shadow capture: writes a full btc_window_snapshots row
// every 30 seconds so every live 15m window ends up with a
// ~30s cadence of observations from T-8m to close, whether or not a study
// lock fired. Read-only w.r.t. trading — places no orders.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

async function backfillOutcomes() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: pending } = await supabaseAdmin
    .from("btc_window_snapshots")
    .select("ticker")
    .is("outcome", null)
    .lt("close_time", cutoff)
    .limit(500);
  const tickers = [...new Set((pending ?? []).map((r) => r.ticker as string))];
  if (!tickers.length) return 0;

  const { data: preds } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, outcome")
    .in("ticker", tickers)
    .not("outcome", "is", null);

  let updated = 0;
  for (const p of preds ?? []) {
    const { error } = await supabaseAdmin
      .from("btc_window_snapshots")
      .update({ outcome: p.outcome as string })
      .eq("ticker", p.ticker as string)
      .is("outcome", null);
    if (!error) updated++;
  }
  return updated;
}

export const Route = createFileRoute("/api/public/hooks/window-snapshot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const __cronAuth = await verifyCronRequest(request);
        if (__cronAuth) return __cronAuth;

        const { captureWindowSnapshot } = await import("@/lib/windowSnapshotCapture.server");

        const capture = await captureWindowSnapshot();

        let backfilled = 0;
        try {
          backfilled = await backfillOutcomes();
        } catch {
          /* non-fatal */
        }

        return new Response(JSON.stringify({ ok: true, capture, backfilled }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
