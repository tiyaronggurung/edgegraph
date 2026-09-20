import { binanceJson } from "@/lib/binanceFetch";
// 1-second composite BTC spot (median of Coinbase, Binance, Kraken).
// Lightweight, no auth — used by the trendline chart to tick the forming
// candle every second. Kept independent from cryptoBtc.functions.ts so the
// hot path stays cheap.

import { createServerFn } from "@tanstack/react-start";

export interface CompositeSpot {
  ok: boolean;
  spot: number | null;
  sources: Array<{ venue: "coinbase" | "binance" | "kraken"; price: number }>;
  fetchedAtMs: number;
  error: string | null;
}

async function coinbase(): Promise<number> {
  const j = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", {
    headers: { "User-Agent": "edgegraph/1.0" },
  }).then(r => r.json() as Promise<{ price?: string }>);
  return Number(j.price);
}
async function binance(): Promise<number> {
  const j = await binanceJson<{ price?: string }>("/api/v3/ticker/price?symbol=BTCUSDT");
  return Number(j.price);
}
async function kraken(): Promise<number> {
  const j = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD")
    .then(r => r.json() as Promise<{ result?: Record<string, { c?: string[] }> }>);
  const k = Object.values(j.result ?? {})[0];
  return Number(k?.c?.[0]);
}

export const getCompositeSpot = createServerFn({ method: "GET" }).handler(
  async (): Promise<CompositeSpot> => {
    const t0 = Date.now();
    const results = await Promise.allSettled([
      coinbase().then(p => ({ venue: "coinbase" as const, price: p })),
      binance().then(p => ({ venue: "binance" as const, price: p })),
      kraken().then(p => ({ venue: "kraken" as const, price: p })),
    ]);
    const sources = results
      .map(r => r.status === "fulfilled" ? r.value : null)
      .filter((x): x is { venue: "coinbase" | "binance" | "kraken"; price: number } =>
        !!x && Number.isFinite(x.price) && x.price > 0,
      );
    if (!sources.length) {
      return { ok: false, spot: null, sources: [], fetchedAtMs: t0, error: "all venues failed" };
    }
    const sorted = [...sources].sort((a, b) => a.price - b.price);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid].price : (sorted[mid - 1].price + sorted[mid].price) / 2;
    return { ok: true, spot: Number(median.toFixed(2)), sources, fetchedAtMs: t0, error: null };
  },
);
