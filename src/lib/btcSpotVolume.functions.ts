import { binanceFetch } from "@/lib/binanceFetch";
// BTC spot volume with taker buy/sell split.
//
// Binance klines already carry the aggressor split for free, keyless:
//   [ openTime, o, h, l, c, baseVol, closeTime, quoteVol, trades,
//     takerBuyBaseVol, takerBuyQuoteVol, ignore ]
// sellVol = baseVol - takerBuyBaseVol, so imbalance = (buy - sell) / total.
//
// We return both the last closed minute and the running 15m window so the
// dashboard can compare spot aggressor flow against Kalshi contract-side flow.

import { createServerFn } from "@tanstack/react-start";

export interface SpotVolumeLeg {
  buy: number;
  sell: number;
  total: number;
  /** (buy - sell) / total, -1..1. Positive = net taker buying. */
  imbalance: number;
  trades: number;
  /** USD notional bought (taker buy quote volume). */
  buyUsd: number;
  /** USD notional sold (quote volume minus taker buy quote volume). */
  sellUsd: number;
  /** Volume-weighted average price paid by buyers (money IN). */
  avgBuyPrice: number | null;
  /** Volume-weighted average price received by sellers (money OUT). */
  avgSellPrice: number | null;
}

export interface BtcSpotVolume {
  ok: boolean;
  source: string;
  /** Last fully closed 1m candle. */
  m1: SpotVolumeLeg | null;
  /** Rolling last 3 minutes — the leg that actually carries predictive edge. */
  m3: SpotVolumeLeg | null;
  /** Rolling last 15 minutes. */
  m15: SpotVolumeLeg | null;
  /** Current 15m Kalshi-aligned window (since :00/:15/:30/:45). */
  window: SpotVolumeLeg | null;
  /** Epoch ms of the window the `window` leg belongs to. */
  windowStart: number | null;
  lastCloseTime: number | null;
  error: string | null;
}

let cache: { at: number; value: BtcSpotVolume } | null = null;
let inFlight: Promise<BtcSpotVolume> | null = null;
const CACHE_MS = 2_000;

async function fetchBtcSpotVolume(): Promise<BtcSpotVolume> {
    const empty: BtcSpotVolume = {
      ok: false, source: "binance", m1: null, m3: null, m15: null, window: null,
      windowStart: null, lastCloseTime: null, error: null,
    };

    const leg = (rows: number[][]): SpotVolumeLeg | null => {
      if (rows.length === 0) return null;
      let total = 0, buy = 0, trades = 0, quote = 0, buyQuote = 0;
      for (const r of rows) {
        const v = Number(r[5]);
        const tb = Number(r[9]);
        const n = Number(r[8]);
        const q = Number(r[7]);
        const tbq = Number(r[10]);
        if (Number.isFinite(v)) total += v;
        if (Number.isFinite(tb)) buy += tb;
        if (Number.isFinite(n)) trades += n;
        if (Number.isFinite(q)) quote += q;
        if (Number.isFinite(tbq)) buyQuote += tbq;
      }
      const sell = Math.max(0, total - buy);
      const sellQuote = Math.max(0, quote - buyQuote);
      return {
        buy: Number(buy.toFixed(4)),
        sell: Number(sell.toFixed(4)),
        total: Number(total.toFixed(4)),
        imbalance: total > 0 ? Number(((buy - sell) / total).toFixed(4)) : 0,
        trades,
        buyUsd: Number(buyQuote.toFixed(2)),
        sellUsd: Number(sellQuote.toFixed(2)),
        avgBuyPrice: buy > 0 ? Number((buyQuote / buy).toFixed(2)) : null,
        avgSellPrice: sell > 0 ? Number((sellQuote / sell).toFixed(2)) : null,
      };
    };

    try {
      const res = await binanceFetch(
        "/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=31",
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) return { ...empty, error: `binance ${res.status}` };
      const raw = (await res.json()) as unknown[][];
      const rows = raw
        .map((r) => r.map((x) => Number(x)))
        .filter((r) => Number.isFinite(r[0]));
      if (rows.length === 0) return { ...empty, error: "no klines" };

      const now = Date.now();
      // Last element is the in-progress candle; the one before it is closed.
      const closed = rows.filter((r) => r[6] < now);
      const last = closed[closed.length - 1] ?? null;

      // Kalshi 15m window start: floor to :00/:15/:30/:45.
      const winStart = Math.floor(now / 900_000) * 900_000;
      const winRows = rows.filter((r) => r[0] >= winStart);

      return {
        ok: true,
        source: "binance:BTCUSDT",
        m1: last ? leg([last]) : null,
        m3: leg(closed.slice(-3)),
        m15: leg(rows.slice(-15)),
        window: leg(winRows),
        windowStart: winStart,
        lastCloseTime: last ? last[6] : null,
        error: null,
      };
    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
}

export async function loadBtcSpotVolume(): Promise<BtcSpotVolume> {
    const now = Date.now();
    const currentWindow = Math.floor(now / 900_000) * 900_000;
    if (
      cache != null &&
      cache.value.windowStart === currentWindow &&
      now - cache.at < CACHE_MS
    ) {
      return cache.value;
    }
    if (inFlight != null) return inFlight;
    inFlight = fetchBtcSpotVolume()
      .then((value) => {
        if (value.ok && value.windowStart === currentWindow) {
          cache = { at: Date.now(), value };
          return value;
        }
        // A temporary mirror failure must not blank an already-populated card.
        // Only reuse data from the same 15-minute window.
        if (cache?.value.windowStart === currentWindow) return cache.value;
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
}

export const getBtcSpotVolume = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcSpotVolume> => loadBtcSpotVolume(),
);
