// Always-on "Study lean" writer — PAPER TEST + SCREEN ONLY.
//
// The real Study lock (btc_model_predictions.study_locked_side, written by
// study-lock-tick) only fires when thresholds and gates pass, so many windows
// have no Study signal at all. Live bots depend on that selectivity, so it
// must never change. This job instead writes SEPARATE columns
// (study_lean_side / study_lean_conf / study_lean_ratio / study_lean_at)
// every window using the same physics measurement (last 120s of server spot
// ticks vs the window strike): ratio ≥ 0.5 → YES, else NO. No gates, no
// thresholds — it always leans somewhere, every window.
//
// Read by the quad paper engine as a Study fallback and shown on the panel.
// It never touches study_locked_side or any live trading path.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

const QUARTER_MS = 15 * 60 * 1000;

export const Route = createFileRoute("/api/public/hooks/study-lean-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowMs = Date.now();
        const closeMs = (Math.floor(nowMs / QUARTER_MS) + 1) * QUARTER_MS;
        const closeIso = new Date(closeMs).toISOString();

        const [{ data: rows }, { data: ticks }] = await Promise.all([
          supabaseAdmin
            .from("btc_model_predictions")
            .select("id, ticker, strike")
            .eq("close_time", closeIso)
            .limit(5),
          supabaseAdmin
            .from("btc_spot_ticks")
            .select("spot")
            .gte("observed_at", new Date(nowMs - 120_000).toISOString())
            .order("observed_at", { ascending: false })
            .limit(240),
        ]);

        const spots = (ticks ?? [])
          .map((t: any) => Number(t.spot))
          .filter((x: number) => Number.isFinite(x));
        if ((rows ?? []).length === 0) {
          return Response.json({ ok: true, updated: 0, reason: "no prediction row for this window" });
        }
        if (spots.length < 10) {
          return Response.json({ ok: true, updated: 0, reason: `too_few_ticks (${spots.length})` });
        }

        const results: Array<Record<string, unknown>> = [];
        for (const r of rows ?? []) {
          const strike = Number((r as any).strike);
          if (!strike || !Number.isFinite(strike)) {
            results.push({ ticker: (r as any).ticker, skipped: "no_strike" });
            continue;
          }
          const above = spots.filter((s: number) => s >= strike).length;
          const ratio = above / spots.length;
          const side: "YES" | "NO" = ratio >= 0.5 ? "YES" : "NO";
          const conf = Math.round(Math.max(ratio, 1 - ratio) * 100);
          const { error } = await supabaseAdmin
            .from("btc_model_predictions")
            .update({
              study_lean_side: side,
              study_lean_conf: conf,
              study_lean_ratio: Number(ratio.toFixed(4)),
              study_lean_at: new Date().toISOString(),
            } as never)
            .eq("id", (r as any).id);
          results.push({ ticker: (r as any).ticker, lean: side, conf, ratio: Number(ratio.toFixed(3)), error: error?.message ?? null });
        }
        return Response.json({ ok: true, ticks: spots.length, updated: results.length, results });
      },
    },
  },
});
