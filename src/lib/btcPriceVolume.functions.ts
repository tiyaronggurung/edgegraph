// BTC price + real spot volume (Binance BTCUSDT) — read-only display feed.
// Returns live last price, 24h change, and 24h traded volume (BTC and USD).
import { createServerFn } from "@tanstack/react-start";

export interface BtcPriceVolume {
  ok: boolean;
  source: string;
  price: number | null;
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  /** BTC traded in the last 24h. */
  volume24hBtc: number | null;
  /** USD notional traded in the last 24h. */
  volume24hUsd: number | null;
  trades24h: number | null;
  error: string | null;
}

export const getBtcPriceVolume = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcPriceVolume> => {
    const empty: BtcPriceVolume = {
      ok: false, source: "binance", price: null, change24hPct: null,
      high24h: null, low24h: null, volume24hBtc: null, volume24hUsd: null,
      trades24h: null, error: null,
    };
    try {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) return { ...empty, error: `binance ${res.status}` };
      const j = (await res.json()) as Record<string, unknown>;
      const num = (k: string): number | null => {
        const v = Number(j[k]);
        return Number.isFinite(v) ? v : null;
      };
      return {
        ok: true,
        source: "binance:BTCUSDT",
        price: num("lastPrice"),
        change24hPct: num("priceChangePercent"),
        high24h: num("highPrice"),
        low24h: num("lowPrice"),
        volume24hBtc: num("volume"),
        volume24hUsd: num("quoteVolume"),
        trades24h: num("count"),
        error: null,
      };
    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
  },
);
