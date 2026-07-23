// Read BTC candles from the shared cache (public.btc_candles). If the cache
// is stale by > 2× the interval we synchronously refresh from Coinbase so the
// chart never shows a gaping hole. Purely a display cache — no trading impact.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { TCandle } from "@/lib/ta/trendlines";

export const TF_LIST = ["1m", "5m", "15m", "1h", "1d"] as const;
export type CandleTf = typeof TF_LIST[number];

const TF_SECONDS: Record<CandleTf, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86_400,
};
const CB_GRANULARITY: Partial<Record<CandleTf, number>> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86_400,
};

const inputSchema = z.object({
  tf: z.enum(TF_LIST),
  limit: z.number().int().min(20).max(2000).default(300),
});

export interface CandlesResult {
  tf: CandleTf;
  candles: TCandle[];
  source: "cache" | "cache+live" | "live";
}

async function fetchCoinbaseLive(tf: Exclude<CandleTf, "1w">, limit: number): Promise<TCandle[]> {
  const g = CB_GRANULARITY[tf]!;
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.min(300, limit) * g;
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${g}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "bettinggraph/1.0" } });
  if (!res.ok) throw new Error(`coinbase ${tf} ${res.status}`);
  const raw = (await res.json()) as [number, number, number, number, number, number][];
  return raw
    .map((r) => ({ t: r[0] * 1000, o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] }))
    .sort((a, b) => a.t - b.t);
}

export const getBtcCandles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<CandlesResult> => {
    const { tf, limit } = data;

    // Read from cache first.
    const { data: rows, error } = await context.supabase
      .from("btc_candles")
      .select("bucket_start,o,h,l,c,v")
      .eq("tf", tf)
      .order("bucket_start", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const cacheCandles: TCandle[] = (rows ?? [])
      .map((r) => ({
        t: new Date(r.bucket_start as string).getTime(),
        o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c),
        v: r.v != null ? Number(r.v) : undefined,
      }))
      .sort((a, b) => a.t - b.t);

    // Decide freshness. If newest cache bucket is older than 2× interval
    // (or we have <5 rows), top up from live so the chart is never blank/stale.
    const newest = cacheCandles.length ? cacheCandles[cacheCandles.length - 1].t : 0;
    const ageMs = Date.now() - newest;
    const stale = cacheCandles.length < 5 || ageMs > TF_SECONDS[tf] * 2000;

    if (!stale) return { tf, candles: cacheCandles, source: "cache" };
    if (tf === "1w") {
      // Weekly comes from cache only (built by ingest); no live fallback.
      return { tf, candles: cacheCandles, source: "cache" };
    }

    try {
      const live = await fetchCoinbaseLive(tf, limit);
      if (!cacheCandles.length) return { tf, candles: live, source: "live" };
      // Merge — cache is authoritative for older buckets, live for newer.
      const byT = new Map<number, TCandle>();
      for (const c of cacheCandles) byT.set(c.t, c);
      for (const c of live) byT.set(c.t, c);
      const merged = Array.from(byT.values()).sort((a, b) => a.t - b.t).slice(-limit);
      return { tf, candles: merged, source: "cache+live" };
    } catch {
      return { tf, candles: cacheCandles, source: "cache" };
    }
  });
