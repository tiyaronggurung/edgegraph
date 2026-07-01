import { useEffect, useRef, useState } from "react";

// Aggregated trade stream from Binance — gives us {price, qty, isBuyerMaker}
// which the plain @trade stream + our spot hook do not expose. Kept SEPARATE
// from useBinanceBtcSpot so the working price feed is never destabilized.
//
// Buffer holds the last ~30 minutes of aggTrade ticks (usually a few thousand
// entries; bounded hard at MAX_TICKS to protect memory).
export interface BtcTick {
  t: number;       // trade time (ms)
  p: number;       // price
  q: number;       // quantity (BTC)
  m: boolean;      // isBuyerMaker (true = market-sell, false = market-buy)
}

const MAX_TICKS = 8000;      // safety cap
const CUTOFF_MS = 30 * 60_000; // keep 30 min of history

export function useBinanceBtcTicks(): { ticks: BtcTick[]; connected: boolean; count: number } {
  const bufRef = useRef<BtcTick[]>([]);
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@aggTrade");
        ws.onopen = () => { if (!cancelled) setConnected(true); };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            const p = parseFloat(msg.p);
            const q = parseFloat(msg.q);
            const T = Number(msg.T);
            const m = Boolean(msg.m);
            if (!Number.isFinite(p) || !Number.isFinite(q) || !Number.isFinite(T)) return;
            const buf = bufRef.current;
            buf.push({ t: T, p, q, m });
            // Trim: cap size + drop old entries.
            const cutoff = Date.now() - CUTOFF_MS;
            while (buf.length && buf[0].t < cutoff) buf.shift();
            if (buf.length > MAX_TICKS) buf.splice(0, buf.length - MAX_TICKS);
          } catch { /* ignore */ }
        };
        ws.onerror = () => setConnected(false);
        ws.onclose = () => {
          setConnected(false);
          if (!cancelled) reconnectTimer = setTimeout(connect, 2000);
        };
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(connect, 2000);
      }
    };

    // Flush a re-render every 1s (React doesn't need every tick — the buffer is authoritative).
    flushTimer = setInterval(() => { if (!cancelled) setTick(x => x + 1); }, 1000);
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearInterval(flushTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  void tick;
  return { ticks: bufRef.current, connected, count: bufRef.current.length };
}
