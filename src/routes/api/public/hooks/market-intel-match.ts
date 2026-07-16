// Cron hook: flip pending → matched | missing | ambiguous on btc_market_intel
// by joining against settled btc_model_predictions. Called by pg_cron every 5 min.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/market-intel-match")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const graceMinutes = 5;
        const maxRows = 5000;
        const cutoff = new Date(Date.now() - graceMinutes * 60_000).toISOString();
        const missingCutoff = new Date(Date.now() - 6 * 60 * 60_000).toISOString();

        const { data: pending, error: readErr } = await supabaseAdmin
          .from("btc_market_intel")
          .select("id, ticker, close_time")
          .eq("settlement_link_status", "pending")
          .lt("window_close_ts", cutoff)
          .limit(maxRows);

        if (readErr) {
          return Response.json({ ok: false, reason: readErr.message }, { status: 500 });
        }

        const rows = (pending ?? []) as Array<{ id: string; ticker: string; close_time: string }>;
        let matched = 0, missing = 0, ambiguous = 0;

        const groups = new Map<string, { key: { ticker: string; close_time: string }; ids: string[] }>();
        for (const r of rows) {
          const k = `${r.ticker}||${r.close_time}`;
          const g = groups.get(k) ?? { key: { ticker: r.ticker, close_time: r.close_time }, ids: [] };
          g.ids.push(r.id);
          groups.set(k, g);
        }

        for (const g of groups.values()) {
          const { data: preds } = await supabaseAdmin
            .from("btc_model_predictions")
            .select("outcome, was_correct, settled_at")
            .eq("ticker", g.key.ticker)
            .eq("close_time", g.key.close_time)
            .not("settled_at", "is", null);

          const settled = (preds ?? []) as Array<{ outcome: string | null }>;
          let nextStatus: "matched" | "missing" | "ambiguous" | null = null;

          if (settled.length === 0) {
            if (g.key.close_time < missingCutoff) nextStatus = "missing";
          } else {
            const outcomes = new Set(settled.map(s => s.outcome).filter(Boolean));
            nextStatus = outcomes.size <= 1 ? "matched" : "ambiguous";
          }
          if (!nextStatus) continue;

          const { error: upErr } = await supabaseAdmin
            .from("btc_market_intel")
            .update({ settlement_link_status: nextStatus })
            .in("id", g.ids);
          if (upErr) continue;

          if (nextStatus === "matched") matched += g.ids.length;
          else if (nextStatus === "missing") missing += g.ids.length;
          else ambiguous += g.ids.length;
        }

        return Response.json({ ok: true, scanned: rows.length, groups: groups.size, matched, missing, ambiguous });
      },
    },
  },
});
