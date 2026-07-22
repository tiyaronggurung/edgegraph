// Public cron hook for multi-TF shadow evaluator.
// Called every minute by pg_cron. Also backfills settlement outcomes for
// windows whose close time has passed.

import { createFileRoute } from "@tanstack/react-router";
import { runMultiTfShadow } from "@/lib/multiTfShadow.functions";

export const Route = createFileRoute("/api/public/hooks/multi-tf-shadow")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        if (!key || key !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("unauthorized", { status: 401 });
        }
        try {
          const evalRes = await runMultiTfShadow();

          // Backfill settlement for closed windows without settled_outcome.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
          const { data: pending } = await supabaseAdmin
            .from("btc_multi_tf_decision_log")
            .select("id, window_ticker, strike_price, proposed_side, multi_tf_side, ta_only_side")
            .lt("window_close_at", cutoff)
            .is("settled_outcome", null)
            .limit(200);

          let settled = 0;
          if (pending && pending.length) {
            // Group by ticker to avoid duplicate Kalshi hits
            const tickers = Array.from(new Set(pending.map((r: any) => r.window_ticker)));
            const truthByTicker = new Map<string, { close: number; outcome: "UP" | "DOWN" } | null>();
            await Promise.all(tickers.map(async (t: string) => {
              try {
                const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${t}`);
                if (!r.ok) { truthByTicker.set(t, null); return; }
                const j = await r.json() as any;
                const market = j?.market;
                const result = market?.result; // "yes"|"no"|null
                const settlement = Number(market?.settlement_value ?? market?.floor_strike);
                if (result === "yes") truthByTicker.set(t, { close: settlement, outcome: "UP" });
                else if (result === "no") truthByTicker.set(t, { close: settlement, outcome: "DOWN" });
                else truthByTicker.set(t, null);
              } catch { truthByTicker.set(t, null); }
            }));

            for (const row of pending as any[]) {
              const truth = truthByTicker.get(row.window_ticker);
              if (!truth) continue;
              const taOnlyRes = row.ta_only_side === truth.outcome ? "WIN"
                : row.ta_only_side === "NEUTRAL" || row.ta_only_side === "SKIP" ? "SKIP" : "LOSS";
              const mtfRes = row.multi_tf_side === truth.outcome ? "WIN"
                : row.multi_tf_side === "SKIP" ? "SKIP" : "LOSS";
              await supabaseAdmin.from("btc_multi_tf_decision_log")
                .update({
                  settled_close: truth.close,
                  settled_outcome: truth.outcome,
                  ta_only_result: taOnlyRes,
                  multi_tf_result: mtfRes,
                })
                .eq("id", row.id);
              settled++;
            }
          }

          return Response.json({ ok: true, ...evalRes, settled });
        } catch (e: any) {
          console.error("[multi-tf-shadow] failed:", e?.message);
          return Response.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
        }
      },
    },
  },
});
