// Multi-exchange BTC spot volume for the CURRENT 15m window.
//
// Context-only: totals per venue (Binance, Coinbase, Kraken, Bitstamp).
// Only Binance publishes a free taker buy/sell split, so the directional
// in/out signal stays Binance-only (see btcSpotVolume.functions.ts).
// This feed is completely separate so it can never slow the odds path.

import { createServerFn } from "@tanstack/react-start";
import { binanceFetch } from "@/lib/binanceFetch";

export interface VenueVolume {
  venue: string;
  btc: number | null;
  error: string | null;
}

export interface BtcMultiVenueVolume {
  ok: boolean;
  windowStart: number;
  venues: VenueVolume[];
  /** Sum of every venue that answered. */
  totalBtc: number;
  /** Binance share of the answered total, 0..1. */
  binanceShare: number | null;
}

const TIMEOUT = 3500;

async function j(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export const getBtcMultiVenueVolume = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcMultiVenueVolume> => {
    const now = Date.now();
    const winStart = Math.floor(now / 900_000) * 900_000;

    const binance = async (): Promise<number> => {
      const res = await binanceFetch(
        "/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=16",
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`binance ${res.status}`);
      const raw = (await res.json()) as unknown[][];
      return raw
        .map((r) => r.map((x) => Number(x)))
        .filter((r) => Number.isFinite(r[0]) && r[0] >= winStart)
        .reduce((s, r) => s + (Number.isFinite(r[5]) ? r[5] : 0), 0);
    };

    const coinbase = async (): Promise<number> => {
      const start = new Date(winStart).toISOString();
      const end = new Date(now).toISOString();
      const d = (await j(
        `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${start}&end=${end}`,
      )) as number[][];
      return d
        .filter((r) => Number(r[0]) * 1000 >= winStart)
        .reduce((s, r) => s + (Number.isFinite(Number(r[5])) ? Number(r[5]) : 0), 0);
    };

    const kraken = async (): Promise<number> => {
      const d = (await j(
        `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1&since=${Math.floor(winStart / 1000) - 60}`,
      )) as { result?: Record<string, unknown> };
      const result = d.result ?? {};
      const key = Object.keys(result).find((k) => k !== "last");
      const rows = (key ? result[key] : null) as unknown[][] | null;
      if (!rows) throw new Error("no rows");
      return rows
        .filter((r) => Number(r[0]) * 1000 >= winStart)
        .reduce((s, r) => s + (Number.isFinite(Number(r[6])) ? Number(r[6]) : 0), 0);
    };

    const bitstamp = async (): Promise<number> => {
      const d = (await j(
        "https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=60&limit=16",
      )) as { data?: { ohlc?: { timestamp: string; volume: string }[] } };
      const rows = d.data?.ohlc ?? [];
      return rows
        .filter((r) => Number(r.timestamp) * 1000 >= winStart)
        .reduce((s, r) => s + (Number.isFinite(Number(r.volume)) ? Number(r.volume) : 0), 0);
    };

    const defs: { venue: string; run: () => Promise<number> }[] = [
      { venue: "Binance", run: binance },
      { venue: "Coinbase", run: coinbase },
      { venue: "Kraken", run: kraken },
      { venue: "Bitstamp", run: bitstamp },
    ];

    const settled = await Promise.allSettled(defs.map((d) => d.run()));
    const venues: VenueVolume[] = settled.map((s, i) => ({
      venue: defs[i]!.venue,
      btc: s.status === "fulfilled" ? Number(s.value.toFixed(3)) : null,
      error: s.status === "rejected" ? String((s.reason as Error)?.message ?? "error") : null,
    }));

    const totalBtc = venues.reduce((s, v) => s + (v.btc ?? 0), 0);
    const bin = venues.find((v) => v.venue === "Binance")?.btc ?? null;

    return {
      ok: venues.some((v) => v.btc != null),
      windowStart: winStart,
      venues,
      totalBtc: Number(totalBtc.toFixed(3)),
      binanceShare: bin != null && totalBtc > 0 ? Number((bin / totalBtc).toFixed(3)) : null,
    };
  },
);
