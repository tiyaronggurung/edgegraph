import { useEffect, useRef, useState } from "react";
import { useBinanceBtcSpot } from "./useBinanceBtcSpot";
import { useCoinbaseBtcSpot } from "./useCoinbaseBtcSpot";
import { useBitstampBtcSpot } from "./useBitstampBtcSpot";
import { useBitfinexBtcSpot } from "./useBitfinexBtcSpot";

// Live composite BTC spot, smoothed for display.
//
// Ticks come from 4 exchange WebSockets: Coinbase, Binance, Bitstamp,
// Bitfinex (~50–200ms per trade). Coinbase + Bitstamp are CF BRR / BRRNY
// constituents — the index family Kalshi's BTC settlement is closest to —
// so we weight them heavier to converge on Kalshi's reference faster than
// Kalshi itself re-quotes it.
//
// Robustness layer:
//   1. Outlier trim: drop any venue > 25 bps from the cross-venue median
//      before weighting. A flash spike on one exchange can't drag the
//      composite.
//   2. Weighted mean of the surviving venues (Coinbase 0.50,
//      Bitstamp 0.20, Binance 0.20, Bitfinex 0.10). Weights renormalize
//      when a venue is missing/trimmed so the composite never blanks out.
//   3. rAF interpolation toward the target at ~60fps for smooth motion.
//   4. Per-frame delta cap so a single-print spike can't teleport the marker.
export interface LiveCompositeSpot {
  spot: number | null;          // smoothed display value
  targetSpot: number | null;    // raw weighted target
  lastTickMs: number | null;
  connected: boolean;
  sources: number;
}

// Cap per-second drift when interpolating. 3 USD/frame @60fps = ~180 USD/s,
// which comfortably covers any real BTC move while filtering microspikes.
const MAX_STEP_USD = 3.0;
// Snap to target once we're within a cent — avoids infinite lerp.
const SNAP_EPSILON = 0.01;
// Trim venues that deviate > 25 bps from cross-venue median (outlier guard).
const OUTLIER_BPS = 25;

const VENUE_WEIGHTS = {
  coinbase: 0.50,
  bitstamp: 0.20,
  binance:  0.20,
  bitfinex: 0.10,
} as const;

interface Sample { venue: keyof typeof VENUE_WEIGHTS; price: number }

function medianOf(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function useLiveCompositeSpot(): LiveCompositeSpot {
  const cb = useCoinbaseBtcSpot();
  const bin = useBinanceBtcSpot();
  const bst = useBitstampBtcSpot();
  const bfx = useBitfinexBtcSpot();

  const [displaySpot, setDisplaySpot] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [sources, setSources] = useState(0);
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);

  const targetRef = useRef<number | null>(null);
  const currentRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const samples: Sample[] = [];
    if (cb.price != null && Number.isFinite(cb.price))   samples.push({ venue: "coinbase", price: cb.price });
    if (bst.price != null && Number.isFinite(bst.price)) samples.push({ venue: "bitstamp", price: bst.price });
    if (bin.price != null && Number.isFinite(bin.price)) samples.push({ venue: "binance",  price: bin.price });
    if (bfx.price != null && Number.isFinite(bfx.price)) samples.push({ venue: "bitfinex", price: bfx.price });

    if (samples.length) {
      // Outlier trim vs cross-venue median (only meaningful with ≥3 venues).
      let kept = samples;
      if (samples.length >= 3) {
        const med = medianOf(samples.map(s => s.price));
        const maxDev = med * (OUTLIER_BPS / 10_000);
        const trimmed = samples.filter(s => Math.abs(s.price - med) <= maxDev);
        if (trimmed.length >= 2) kept = trimmed;
      }

      // Weighted mean with renormalized weights over surviving venues.
      let wSum = 0, pSum = 0;
      for (const s of kept) {
        const w = VENUE_WEIGHTS[s.venue];
        wSum += w;
        pSum += w * s.price;
      }
      const target = wSum > 0 ? pSum / wSum : kept[0].price;

      targetRef.current = target;
      if (currentRef.current == null) currentRef.current = target;
      setSources(kept.length);
      setLastTickMs(Math.max(
        cb.lastTickMs ?? 0,
        bst.lastTickMs ?? 0,
        bin.lastTickMs ?? 0,
        bfx.lastTickMs ?? 0,
      ) || Date.now());
    }
    const anyLive = cb.connected || bin.connected || bst.connected || bfx.connected;
    setConnected(anyLive || sources > 0);
  }, [
    cb.price, cb.lastTickMs, cb.connected,
    bin.price, bin.lastTickMs, bin.connected,
    bst.price, bst.lastTickMs, bst.connected,
    bfx.price, bfx.lastTickMs, bfx.connected,
    sources,
  ]);

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

    // rAF is frozen while the tab is hidden, so on return the displayed value
    // can be far behind. Snap straight to the live target instead of walking
    // it back a few dollars per frame.
    const snap = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const target = targetRef.current;
      if (target == null) return;
      currentRef.current = target;
      setDisplaySpot(Number(target.toFixed(2)));
    };
    document.addEventListener("visibilitychange", snap);
    window.addEventListener("focus", snap);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", snap);
      window.removeEventListener("focus", snap);
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
