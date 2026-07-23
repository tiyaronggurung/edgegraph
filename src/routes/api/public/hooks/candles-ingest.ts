// Ingest BTC candles into public.btc_candles for all supported timeframes.
// Called by pg_cron every minute; internally decides which TFs to refresh
// based on interval (only fetches TFs whose newest bucket is stale).
// Shadow-only cache — nothing here touches trading logic.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

type TF = "1m" | "5m" | "15m" | "1h" | "1d" | "1w";
const TF_SECONDS: Record<TF, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86_400, "1w": 604_800,
};
// Coinbase supports 60/300/900/3600/21600/86400. For 1w, aggregate from 1d.
const CB_GRANULARITY: Partial<Record<TF, number>> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86_400,
};

interface Row { tf: TF; bucket_start: string; o: number; h: number; l: number; c: number; v: number | null; source: string }

async function fetchCoinbase(tf: Exclude<TF, "1w">, limit: number): Promise<Row[]> {
  const g = CB_GRANULARITY[tf]!;
  const end = Math.floor(Date.now() / 1000);
  const start = end - limit * g;
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${g}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "bettinggraph/1.0" } });
  if (!res.ok) throw new Error(`coinbase ${tf} ${res.status}`);
  const raw = (await res.json()) as [number, number, number, number, number, number][];
  return raw
    .map((r) => ({
      tf,
      bucket_start: new Date(r[0] * 1000).toISOString(),
      o: r[3], h: r[2], l: r[1], c: r[4], v: r[5],
      source: "coinbase",
    }))
    .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

// Aggregate 1d rows into ISO weeks (Mon 00:00 UTC).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function build1w(supabaseAdmin: any): Promise<Row[]> {
  const { data } = await supabaseAdmin
    .from("btc_candles")
    .select("bucket_start,o,h,l,c,v")
    .eq("tf", "1d")
    .order("bucket_start", { ascending: true })
    .limit(400);
  if (!data || data.length === 0) return [];
  const byWeek = new Map<string, Row>();
  for (const d of data) {
    const t = new Date(d.bucket_start);
    // Snap to Monday 00:00 UTC.
    const day = t.getUTCDay(); // 0=Sun
    const offset = (day === 0 ? 6 : day - 1);
    const monday = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - offset));
    const key = monday.toISOString();
    const cur = byWeek.get(key);
    if (!cur) {
      byWeek.set(key, {
        tf: "1w", bucket_start: key,
        o: Number(d.o), h: Number(d.h), l: Number(d.l), c: Number(d.c),
        v: d.v != null ? Number(d.v) : 0, source: "agg-1d",
      });
    } else {
      cur.h = Math.max(cur.h, Number(d.h));
      cur.l = Math.min(cur.l, Number(d.l));
      cur.c = Number(d.c);
      cur.v = (cur.v ?? 0) + (d.v != null ? Number(d.v) : 0);
    }
  }
  return Array.from(byWeek.values());
}

export const Route = createFileRoute("/api/public/hooks/candles-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await verifyCronRequest(request); if (auth) return auth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Decide which TFs to refresh this tick: only if newest row is stale
        // by ≥ 1 interval. Cheap read (1 row per tf, indexed).
        const now = Date.now();
        const tfs: TF[] = ["1m", "5m", "15m", "1h", "1d", "1w"];
        const shouldRefresh: TF[] = [];
        for (const tf of tfs) {
          const { data: newest } = await supabaseAdmin
            .from("btc_candles")
            .select("bucket_start")
            .eq("tf", tf)
            .order("bucket_start", { ascending: false })
            .limit(1);
          const newestT = newest?.[0]?.bucket_start
            ? new Date(newest[0].bucket_start).getTime() : 0;
          const ageMs = now - newestT;
          if (ageMs >= TF_SECONDS[tf] * 1000) shouldRefresh.push(tf);
        }

        const results: Record<string, number | string> = {};
        for (const tf of shouldRefresh) {
          try {
            let rows: Row[];
            if (tf === "1w") {
              rows = await build1w(supabaseAdmin);
            } else {
              // Small pull each tick — enough to always catch the latest bucket.
              rows = await fetchCoinbase(tf, tf === "1d" ? 300 : 200);
            }
            if (rows.length) {
              const { error } = await supabaseAdmin
                .from("btc_candles")
                .upsert(rows, { onConflict: "tf,bucket_start" });
              if (error) { results[tf] = `err:${error.message}`; continue; }
            }
            results[tf] = rows.length;
          } catch (e) {
            results[tf] = `err:${(e as Error).message}`;
          }
        }

        // Prune old 1m/5m/15m rows.
        try { await supabaseAdmin.rpc("prune_btc_candles"); } catch { /* ignore */ }

        return new Response(JSON.stringify({ ok: true, refreshed: results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
