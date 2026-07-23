// Cron: server-side ticker for the triple-window Polymarket shadow log.
// Runs every 30s. For each in-flight Kalshi 15m market that hasn't been
// touched by a browser tab in >20s, poll Polymarket and update the row.
// This keeps W1/W2/W3 filling in even when no user has the crypto page open.
//
// - Never stomps fresh client writes (checks updated_at > cutoff).
// - Accumulates open/close/min/max/avg by reading the previous row and
//   folding in a single fresh sample.
// - Does NOT seed new rows — only refreshes existing in-flight rows. If the
//   browser has never been on the page for a given window, that row stays
//   uncreated until the client seeds it (same behavior as before).
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";
import { getPolymarketBtcUpDown } from "@/lib/polymarketOdds";

const STALE_MS = 20_000;

interface Row {
  kalshi_ticker: string;
  market_open_ms: number;
  market_close_ms: number;
  updated_at: string;
  w1_open_prob: number | null; w1_close_prob: number | null;
  w1_min_prob: number | null; w1_max_prob: number | null;
  w1_avg_prob: number | null; w1_samples: number | null;
  w2_open_prob: number | null; w2_close_prob: number | null;
  w2_min_prob: number | null; w2_max_prob: number | null;
  w2_avg_prob: number | null; w2_samples: number | null;
  w3_open_prob: number | null; w3_close_prob: number | null;
  w3_min_prob: number | null; w3_max_prob: number | null;
  w3_avg_prob: number | null; w3_samples: number | null;
}

export const Route = createFileRoute("/api/public/hooks/triple-window-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey");
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) return new Response("Server not configured", { status: 500 });

        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const started = Date.now();
        const now = started;
        const staleCutoff = new Date(now - STALE_MS).toISOString();

        // In-flight = market currently open (open <= now < close) AND client
        // hasn't touched the row in >20s. That gap means the tab is closed.
        const { data: rows, error } = await admin
          .from("btc_polymarket_triple_window")
          .select("kalshi_ticker,market_open_ms,market_close_ms,updated_at,w1_open_prob,w1_close_prob,w1_min_prob,w1_max_prob,w1_avg_prob,w1_samples,w2_open_prob,w2_close_prob,w2_min_prob,w2_max_prob,w2_avg_prob,w2_samples,w3_open_prob,w3_close_prob,w3_min_prob,w3_max_prob,w3_avg_prob,w3_samples")
          .lte("market_open_ms", now)
          .gt("market_close_ms", now)
          .lt("updated_at", staleCutoff)
          .limit(20);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const targets = (rows ?? []) as Row[];
        if (targets.length === 0) {
          return Response.json({ checked: 0, updated: 0, ms: Date.now() - started });
        }

        // One Polymarket fetch shared across all in-flight rows (Poly only has
        // one live 5m book per moment). Slightly imprecise if two Kalshi 15m
        // windows overlap on the same Poly 5m window, but shadow-only.
        const odds = await getPolymarketBtcUpDown(now);
        if (!odds) {
          return Response.json({ checked: targets.length, updated: 0, reason: "no-odds", ms: Date.now() - started });
        }
        const sample = odds.effectiveUpProb;

        let updated = 0;
        for (const r of targets) {
          const elapsed = now - r.market_open_ms;
          const phase = Math.min(2, Math.max(0, Math.floor(elapsed / (5 * 60_000))));
          const prefix = phase === 0 ? "w1_" : phase === 1 ? "w2_" : "w3_";
          const prevSamples = Number(r[`${prefix}samples` as keyof Row] ?? 0) || 0;
          const prevOpen = r[`${prefix}open_prob` as keyof Row] as number | null;
          const prevAvg = r[`${prefix}avg_prob` as keyof Row] as number | null;
          const prevMin = r[`${prefix}min_prob` as keyof Row] as number | null;
          const prevMax = r[`${prefix}max_prob` as keyof Row] as number | null;

          const newSamples = prevSamples + 1;
          const newAvg = prevAvg != null && prevSamples > 0
            ? (prevAvg * prevSamples + sample) / newSamples
            : sample;
          const newMin = prevMin != null ? Math.min(prevMin, sample) : sample;
          const newMax = prevMax != null ? Math.max(prevMax, sample) : sample;
          const newOpen = prevOpen ?? sample;

          const combinedDir = sample >= 0.5 ? "YES" : "NO";
          const combinedConf = Math.abs(sample - 0.5) * 2;

          const patch: Record<string, unknown> = {
            [`${prefix}open_prob`]: newOpen,
            [`${prefix}close_prob`]: sample,
            [`${prefix}avg_prob`]: newAvg,
            [`${prefix}min_prob`]: newMin,
            [`${prefix}max_prob`]: newMax,
            [`${prefix}samples`]: newSamples,
            combined_dir: combinedDir,
            combined_conf: combinedConf,
            enrichment_json: {
              phase,
              raw_up_mid: odds.upProb,
              down_mid: odds.downMid,
              last_trade: odds.lastTrade > 0 ? odds.lastTrade : null,
              effective_up_prob: sample,
              source: "cron",
              at: now,
            },
          };

          const { error: upErr } = await admin
            .from("btc_polymarket_triple_window")
            .update(patch)
            .eq("kalshi_ticker", r.kalshi_ticker)
            .lt("updated_at", staleCutoff); // guard against client racing us
          if (!upErr) updated++;
        }

        return Response.json({
          checked: targets.length,
          updated,
          sample,
          ms: Date.now() - started,
        });
      },
    },
  },
});
