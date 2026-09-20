import { binanceJson } from "@/lib/binanceFetch";
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

// Dedicated spot-tick writer.
//
// Study Pick (T+7 snapshot and the T7 lock) reads a rolling 120s window of
// btc_spot_ticks and needs 5 / 30 ticks respectively. Before this job, ticks
// were only written as a side effect of a browser scoring call, so most
// windows had zero ticks at their T7 moment and the study silently produced
// nothing ("insufficient_data" / "too_few_ticks") -> consensus SKIP forever.
//
// This job runs every 20s from pg_cron and takes SAMPLES_PER_RUN evenly
// spaced samples inside the run, so the 120s window always holds far more
// than 30 ticks. Bounded work per run, no chaining, no AI.

const SAMPLES_PER_RUN = 4;
const SAMPLE_GAP_MS = 4_000;

type VenueTick = {
  source: "coinbase" | "binance" | "kraken";
  spot: number;
  sourceTimestampMs: number | null;
};

async function fetchVenues(): Promise<VenueTick[]> {
  const settled = await Promise.allSettled<VenueTick>([
    (async () => {
      const j = (await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", {
        headers: { "User-Agent": "edgegraph/1.0" },
      }).then((r) => r.json())) as { price?: string; time?: string };
      const t = j?.time ? Date.parse(j.time) : NaN;
      return { source: "coinbase" as const, spot: Number(j?.price), sourceTimestampMs: Number.isFinite(t) ? t : null };
    })(),
    (async () => {
      const j = await binanceJson<{ price?: string }>("/api/v3/ticker/price?symbol=BTCUSDT");
      return { source: "binance" as const, spot: Number(j?.price), sourceTimestampMs: null };
    })(),
    (async () => {
      const j = (await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD").then((r) => r.json())) as {
        result?: Record<string, { c?: string[] }>;
      };
      const k = Object.values(j?.result ?? {})[0];
      return { source: "kraken" as const, spot: Number(k?.c?.[0]), sourceTimestampMs: null };
    })(),
  ]);
  return settled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter((t): t is VenueTick => !!t && Number.isFinite(t.spot) && t.spot > 0);
}

function buildRows(ticks: VenueTick[]): Array<Record<string, unknown>> {
  if (!ticks.length) return [];
  const receivedMs = Date.now();
  const receivedIso = new Date(receivedMs).toISOString();
  const receivedSec = Math.floor(receivedMs / 1000);
  const rows: Array<Record<string, unknown>> = ticks.map((t) => {
    const srcTsIso = t.sourceTimestampMs ? new Date(t.sourceTimestampMs).toISOString() : null;
    return {
      observed_at: srcTsIso ?? receivedIso,
      observed_at_sec: t.sourceTimestampMs ? Math.floor(t.sourceTimestampMs / 1000) : receivedSec,
      source_timestamp: srcTsIso,
      received_at: receivedIso,
      latency_ms: t.sourceTimestampMs ? Math.max(0, receivedMs - t.sourceTimestampMs) : null,
      spot: t.spot,
      source: t.source,
      out_of_order: false,
    };
  });
  const vals = ticks.map((t) => t.spot).sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  rows.push({
    observed_at: receivedIso,
    observed_at_sec: receivedSec,
    source_timestamp: null,
    received_at: receivedIso,
    latency_ms: null,
    spot: median,
    source: "consolidated",
    out_of_order: false,
  });
  return rows;
}

export const Route = createFileRoute("/api/public/hooks/spot-tick-writer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let written = 0;
        let samples = 0;
        let lastMedian: number | null = null;

        for (let i = 0; i < SAMPLES_PER_RUN; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, SAMPLE_GAP_MS));
          const ticks = await fetchVenues();
          const rows = buildRows(ticks);
          if (!rows.length) continue;
          samples++;
          lastMedian = Number(rows[rows.length - 1]["spot"]);
          const { error } = await supabaseAdmin
            .from("btc_spot_ticks")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .upsert(rows as any, { onConflict: "source,observed_at_sec", ignoreDuplicates: true });
          if (!error) written += rows.length;
        }

        return Response.json({
          ok: true,
          samples,
          written,
          spot: lastMedian,
          ms: Date.now() - t0,
        });
      },
    },
  },
});
