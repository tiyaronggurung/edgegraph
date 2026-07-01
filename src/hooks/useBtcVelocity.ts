import { useEffect, useRef, useState } from "react";
import { useBinanceBtcSpot } from "./useBinanceBtcSpot";

// Rolling BTC spot velocity computed off the existing Binance WS stream.
// pctChange3min = (nowPrice / priceThreeMinAgo - 1) * 100
// pctChange1min = (nowPrice / priceOneMinAgo   - 1) * 100
// Returns null until the buffer has samples ≥ the requested horizon.
export interface BtcVelocity {
  price: number | null;
  pctChange1min: number | null;
  pctChange3min: number | null;
  samples: number;
  connected: boolean;
}

interface Sample { t: number; p: number }

export function useBtcVelocity(): BtcVelocity {
  const spot = useBinanceBtcSpot();
  const bufRef = useRef<Sample[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (spot.price == null || spot.lastTickMs == null) return;
    const now = spot.lastTickMs;
    const buf = bufRef.current;
    // Sample at most 1×/sec to keep buffer bounded (~180 entries for 3min).
    const last = buf[buf.length - 1];
    if (!last || now - last.t >= 1000) {
      buf.push({ t: now, p: spot.price });
      // Drop samples older than ~5 min for safety margin.
      const cutoff = now - 5 * 60_000;
      while (buf.length && buf[0].t < cutoff) buf.shift();
      setTick(x => x + 1);
    }
  }, [spot.price, spot.lastTickMs]);

  const buf = bufRef.current;
  const now = spot.price;
  const nowMs = spot.lastTickMs ?? Date.now();

  const findAt = (agoMs: number): number | null => {
    if (!buf.length) return null;
    const target = nowMs - agoMs;
    if (buf[0].t > target) return null; // not enough history
    // Walk back-to-front for the nearest sample ≥ target.
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].t >= target) return buf[i].p;
    }
    return buf[buf.length - 1].p;
  };

  // Reference `tick` so the memo/render updates each buffer push.
  void tick;
  const p1 = findAt(60_000);
  const p3 = findAt(180_000);

  return {
    price: now,
    pctChange1min: now != null && p1 != null && p1 > 0 ? (now / p1 - 1) * 100 : null,
    pctChange3min: now != null && p3 != null && p3 > 0 ? (now / p3 - 1) * 100 : null,
    samples: buf.length,
    connected: spot.connected,
  };
}
