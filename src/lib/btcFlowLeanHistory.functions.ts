// Read-only history: per-15m-window flow (BTC in vs out, USD in vs out, avg
// buy/sell price) + actual result, plus rolled-up totals by timeframe.
// Display only — nothing here touches entry, study, model or trendline paths.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface FlowLeanHistoryRow {
  windowStart: string;
  lean: string;
  imbWindow: number | null;
  buyBtc: number | null;
  sellBtc: number | null;
  volBtc: number | null;
  buyUsd: number | null;
  sellUsd: number | null;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  /** "UP" | "DOWN" from the 15m candle open vs close, null while unsettled. */
  result: "UP" | "DOWN" | null;
  hit: boolean | null;
}

export interface FlowRollup {
  label: string;
  buyBtc: number;
  sellBtc: number;
  buyUsd: number;
  sellUsd: number;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  /** USD imbalance: (in - out) / total. */
  netUsdPct: number | null;
  priceChangePct: number | null;
}

export interface FlowLeanHistoryResult {
  rows: FlowLeanHistoryRow[];
  scored: number;
  hits: number;
  rollups: FlowRollup[];
}

const WINDOW_MS = 15 * 60 * 1000;

interface Agg {
  buyBtc: number;
  sellBtc: number;
  buyUsd: number;
  sellUsd: number;
  firstOpen: number | null;
  lastClose: number | null;
}

function emptyAgg(): Agg {
  return { buyBtc: 0, sellBtc: 0, buyUsd: 0, sellUsd: 0, firstOpen: null, lastClose: null };
}

function addKline(agg: Agg, k: number[]) {
  const vol = Number(k[5]) || 0;
  const quote = Number(k[7]) || 0;
  const buyBtc = Number(k[9]) || 0;
  const buyUsd = Number(k[10]) || 0;
  agg.buyBtc += buyBtc;
  agg.sellBtc += Math.max(0, vol - buyBtc);
  agg.buyUsd += buyUsd;
  agg.sellUsd += Math.max(0, quote - buyUsd);
  if (agg.firstOpen == null) agg.firstOpen = Number(k[1]);
  agg.lastClose = Number(k[4]);
}

function toRollup(label: string, agg: Agg): FlowRollup {
  const totalUsd = agg.buyUsd + agg.sellUsd;
  return {
    label,
    buyBtc: agg.buyBtc,
    sellBtc: agg.sellBtc,
    buyUsd: agg.buyUsd,
    sellUsd: agg.sellUsd,
    avgBuyPrice: agg.buyBtc > 0 ? agg.buyUsd / agg.buyBtc : null,
    avgSellPrice: agg.sellBtc > 0 ? agg.sellUsd / agg.sellBtc : null,
    netUsdPct: totalUsd > 0 ? (agg.buyUsd - agg.sellUsd) / totalUsd : null,
    priceChangePct:
      agg.firstOpen && agg.lastClose ? (agg.lastClose - agg.firstOpen) / agg.firstOpen : null,
  };
}

async function fetchKlines(interval: string, limit: number): Promise<number[][]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
    );
    if (!res.ok) return [];
    const kl = (await res.json()) as unknown[][];
    return kl.map((k) => k.map((x) => Number(x)));
  } catch {
    return [];
  }
}

export const getBtcFlowLeanHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlowLeanHistoryResult> => {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const [{ data: logs }, k15, k1m] = await Promise.all([
      context.supabase
        .from("btc_flow_lean_log")
        .select("window_start, seconds_to_close, lean")
        .gte("window_start", since)
        .order("window_start", { ascending: false })
        .order("seconds_to_close", { ascending: true })
        .limit(500),
      fetchKlines("15m", 250),
      fetchKlines("1m", 60),
    ]);

    // Keep the latest row (smallest seconds_to_close) per window.
    const leanByWindow = new Map<string, string>();
    for (const r of logs ?? []) {
      const key = new Date(r.window_start as string).toISOString();
      if (!leanByWindow.has(key)) leanByWindow.set(key, (r.lean as string) ?? "FLAT");
    }

    const now = Date.now();
    const nowWindow = Math.floor(now / WINDOW_MS) * WINDOW_MS;

    // Per-window flow + direction straight from the 15m candles.
    const perWindow = new Map<string, { agg: Agg; result: "UP" | "DOWN" | null }>();
    for (const k of k15) {
      const openTime = Number(k[0]);
      if (!Number.isFinite(openTime)) continue;
      const agg = emptyAgg();
      addKline(agg, k);
      const settled = openTime < nowWindow;
      perWindow.set(new Date(openTime).toISOString(), {
        agg,
        result: settled ? ((agg.lastClose ?? 0) >= (agg.firstOpen ?? 0) ? "UP" : "DOWN") : null,
      });
    }

    let scored = 0;
    let hits = 0;
    const rows: FlowLeanHistoryRow[] = [...leanByWindow.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 16)
      .map(([key, lean]) => {
        const w = perWindow.get(key);
        const agg = w?.agg ?? emptyAgg();
        const result = w?.result ?? null;
        let hit: boolean | null = null;
        if (result && (lean === "UP" || lean === "DOWN")) {
          hit = lean === result;
          scored += 1;
          if (hit) hits += 1;
        }
        const totalBtc = agg.buyBtc + agg.sellBtc;
        return {
          windowStart: key,
          lean,
          imbWindow: totalBtc > 0 ? (agg.buyBtc - agg.sellBtc) / totalBtc : null,
          buyBtc: agg.buyBtc || null,
          sellBtc: agg.sellBtc || null,
          volBtc: totalBtc || null,
          buyUsd: agg.buyUsd || null,
          sellUsd: agg.sellUsd || null,
          avgBuyPrice: agg.buyBtc > 0 ? agg.buyUsd / agg.buyBtc : null,
          avgSellPrice: agg.sellBtc > 0 ? agg.sellUsd / agg.sellBtc : null,
          result,
          hit,
        };
      });

    // Rollups. Short frames from 1m candles, longer ones from 15m candles.
    const rollups: FlowRollup[] = [];

    const agg15 = emptyAgg();
    for (const k of k1m) if (Number(k[0]) >= nowWindow) addKline(agg15, k);
    rollups.push(toRollup("15m", agg15));

    const spans: Array<[string, number]> = [
      ["1h", 60 * 60 * 1000],
      ["4h", 4 * 60 * 60 * 1000],
      ["24h", 24 * 60 * 60 * 1000],
    ];
    for (const [label, ms] of spans) {
      const agg = emptyAgg();
      for (const k of k15) if (Number(k[0]) >= now - ms) addKline(agg, k);
      rollups.push(toRollup(label, agg));
    }

    const dayStart = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    const aggDay = emptyAgg();
    for (const k of k15) if (Number(k[0]) >= dayStart) addKline(aggDay, k);
    rollups.push(toRollup("Today (UTC)", aggDay));

    return { rows, scored, hits, rollups };
  });
