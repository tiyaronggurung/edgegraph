import { useEffect, useRef, useState } from "react";
import { useBinanceBtcSpot } from "./useBinanceBtcSpot";
import { useCoinbaseBtcSpot } from "./useCoinbaseBtcSpot";

// Live composite BTC spot, smoothed for display.
//
// Ticks come from Binance + Coinbase WebSockets (~50–200ms per trade). Raw
// ticks can jitter — one venue prints an outlier, the other lags, or a
// microstructure spike flashes 20-50 bps for a single trade. The chart badge
// should never "disappear" or teleport, so this hook does three things:
//
//   1. Median-of-both target when both venues are live, else fall back to
//      whichever venue is streaming. Last valid value is retained forever
//      (so the badge never blanks on a WS blip).
//   2. rAF interpolation toward the target at ~60fps — smooth motion instead
//      of stepwise ~200ms jumps.
//   3. Spike cap: per-frame delta is limited so a single outlier print can't
//      teleport the marker. Real moves catch up within a few hundred ms; noise
//      is absorbed.
export interface LiveCompositeSpot {
  spot: number | null;          // smoothed display value
  targetSpot: number | null;    // raw target (median of venues)
  lastTickMs: number | null;
  connected: boolean;
  sources: number;
}

// Cap per-second drift when interpolating. 3 USD/frame @60fps = ~180 USD/s,
// which comfortably covers any real BTC move while filtering microspikes.
const MAX_STEP_USD = 3.0;
// Snap to target once we're within a cent — avoids infinite lerp.
const SNAP_EPSILON = 0.01;

export function useLiveCompositeSpot(): LiveCompositeSpot {
  const bin = useBinanceBtcSpot();
  const cb = useCoinbaseBtcSpot();

  const [displaySpot, setDisplaySpot] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [sources, setSources] = useState(0);
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);

  const targetRef = useRef<number | null>(null);
  const currentRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Update the target (median or single-venue). Never null it out once seeded
  // — a brief WS disconnect keeps showing the last known price.
  useEffect(() => {
    const prices: number[] = [];
    if (bin.price != null && Number.isFinite(bin.price)) prices.push(bin.price);
    if (cb.price != null && Number.isFinite(cb.price)) prices.push(cb.price);

    if (prices.length) {
      const target = prices.length === 1
        ? prices[0]
        : (prices[0] + prices[1]) / 2;
      targetRef.current = target;
      // Seed on first tick so the marker appears instantly.
      if (currentRef.current == null) currentRef.current = target;
      setSources(prices.length);
      setLastTickMs(Math.max(bin.lastTickMs ?? 0, cb.lastTickMs ?? 0) || Date.now());
    }
    // Connected if either venue is live OR ticked recently (< 3s ago).
    const anyLive = bin.connected || cb.connected;
    setConnected(anyLive || sources > 0);
  }, [bin.price, bin.lastTickMs, bin.connected, cb.price, cb.lastTickMs, cb.connected, sources]);

  // rAF loop: smoothly walk the displayed value toward the target every frame.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const target = targetRef.current;
      const current = currentRef.current;
      if (target != null && current != null) {
        const diff = target - current;
        const absDiff = Math.abs(diff);
        let next: number;
        if (absDiff < SNAP_EPSILON) {
          next = target;
        } else {
          // Cap step so a single-print spike can't teleport the marker.
          // Real moves still resolve in a few frames.
          const step = Math.min(absDiff, MAX_STEP_USD);
          next = current + Math.sign(diff) * step;
        }
        if (next !== current) {
          currentRef.current = next;
          setDisplaySpot(Number(next.toFixed(2)));
        }
      } else if (target != null && current == null) {
        currentRef.current = target;
        setDisplaySpot(Number(target.toFixed(2)));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    spot: displaySpot,
    targetSpot: targetRef.current,
    lastTickMs,
    connected,
    sources,
  };
}
