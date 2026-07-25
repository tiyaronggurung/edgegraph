import { useMemo } from "react";
import { useBinanceBtcSpot } from "./useBinanceBtcSpot";
import { useCoinbaseBtcSpot } from "./useCoinbaseBtcSpot";

// Live composite BTC spot from Binance + Coinbase WebSockets.
// Ticks per trade (~50–200ms). Median when both venues are live, otherwise
// falls back to whichever venue is streaming. Kept small and read-only.
export interface LiveCompositeSpot {
  spot: number | null;
  lastTickMs: number | null;
  connected: boolean;
  sources: number;
}

export function useLiveCompositeSpot(): LiveCompositeSpot {
  const bin = useBinanceBtcSpot();
  const cb = useCoinbaseBtcSpot();

  return useMemo<LiveCompositeSpot>(() => {
    const prices: number[] = [];
    if (bin.price != null && Number.isFinite(bin.price)) prices.push(bin.price);
    if (cb.price != null && Number.isFinite(cb.price)) prices.push(cb.price);
    if (!prices.length) {
      return { spot: null, lastTickMs: null, connected: false, sources: 0 };
    }
    const spot = prices.length === 1
      ? prices[0]
      : (prices[0] + prices[1]) / 2;
    const lastTickMs = Math.max(bin.lastTickMs ?? 0, cb.lastTickMs ?? 0) || Date.now();
    return {
      spot: Number(spot.toFixed(2)),
      lastTickMs,
      connected: bin.connected || cb.connected,
      sources: prices.length,
    };
  }, [bin.price, bin.lastTickMs, bin.connected, cb.price, cb.lastTickMs, cb.connected]);
}
