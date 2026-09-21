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

/** Taker-side split sampled from Coinbase raw trades for the current window. */
export interface CoinbaseFlow {
  inBtc: number;
  outBtc: number;
  avgIn: number | null;
  avgOut: number | null;
  /** True when the window was not fully covered within the page budget. */
  partial: boolean;
}

export interface BtcMultiVenueVolume {
  ok: boolean;
  windowStart: number;
  venues: VenueVolume[];
  /** Sum of every venue that answered. */
  totalBtc: number;
  /** Binance share of the answered total, 0..1. */
  binanceShare: number | null;
  /** Coinbase taker buy/sell split, null when the trades feed failed. */
  coinbaseFlow: CoinbaseFlow | null;
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

    // Coinbase raw trades: `side` is the MAKER side, so side="sell" means the
    // taker bought (in-flow) and side="buy" means the taker sold (out-flow).
    const coinbaseFlowRun = async (): Promise<CoinbaseFlow> => {
      let after: string | null = null;
      let inBtc = 0,
        outBtc = 0,
        inQ = 0,
        outQ = 0;
      let reachedStart = false;
      for (let page = 0; page < 8; page++) {
        const url: string = `https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000${after ? `&after=${after}` : ""}`;
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), TIMEOUT);
        let rows: { side: string; size: string; price: string; time: string }[];
        let next: string | null;
        try {
          const r = await fetch(url, {
            signal: ctl.signal,
            headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
          });
          if (!r.ok) throw new Error(`coinbase trades ${r.status}`);
          rows = (await r.json()) as typeof rows;
          next = r.headers.get("cb-after");
        } finally {
          clearTimeout(t);
        }
        if (!rows.length) {
          reachedStart = true;
          break;
        }
        for (const tr of rows) {
          const ts = new Date(tr.time).getTime();
          if (!Number.isFinite(ts) || ts < winStart) {
            reachedStart = true;
            continue;
          }
          const sz = Number(tr.size);
          const px = Number(tr.price);
          if (!Number.isFinite(sz) || !Number.isFinite(px)) continue;
          if (tr.side === "sell") {
            inBtc += sz;
            inQ += sz * px;
          } else {
            outBtc += sz;
            outQ += sz * px;
          }
        }
        if (reachedStart || !next) break;
        after = next;
      }
      return {
        inBtc: Number(inBtc.toFixed(3)),
        outBtc: Number(outBtc.toFixed(3)),
        avgIn: inBtc > 0 ? Number((inQ / inBtc).toFixed(2)) : null,
        avgOut: outBtc > 0 ? Number((outQ / outBtc).toFixed(2)) : null,
        partial: !reachedStart,
      };
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
