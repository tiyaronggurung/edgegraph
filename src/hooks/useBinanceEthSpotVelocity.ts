import { useEffect, useRef, useState } from "react";

// Lightweight ETH spot velocity — samples ETHUSDT mini-ticker (1s cadence)
// from Binance and reports 1m and 3m % change. Used for BTC/ETH agreement
// check inside the chart verdict (correlation guard).

export interface EthVelocity {
  connected: boolean;
  price: number | null;
  pctChange1min: number | null;
  pctChange3min: number | null;
}

interface Sample { t: number; p: number }

export function useBinanceEthSpotVelocity(): EthVelocity {
  const [price, setPrice] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const bufRef = useRef<Sample[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket("wss://stream.binance.com:9443/ws/ethusdt@miniTicker");
        ws.onopen = () => { if (!cancelled) setConnected(true); };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            const p = parseFloat(m.c);
            if (!Number.isFinite(p)) return;
            setPrice(p);
            const now = Date.now();
            const buf = bufRef.current;
            const last = buf[buf.length - 1];
            if (!last || now - last.t >= 1000) {
              buf.push({ t: now, p });
              const cutoff = now - 5 * 60_000;
              while (buf.length && buf[0].t < cutoff) buf.shift();
              setTick(x => x + 1);
            }
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
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  void tick;
  const buf = bufRef.current;
  const now = price;
  const nowMs = Date.now();
  const findAt = (agoMs: number): number | null => {
    if (!buf.length) return null;
    const target = nowMs - agoMs;
    if (buf[0].t > target) return null;
    for (let i = 0; i < buf.length; i++) if (buf[i].t >= target) return buf[i].p;
    return buf[buf.length - 1].p;
  };
  const p1 = findAt(60_000);
  const p3 = findAt(180_000);

  return {
    connected,
    price: now,
    pctChange1min: now != null && p1 != null && p1 > 0 ? (now / p1 - 1) * 100 : null,
    pctChange3min: now != null && p3 != null && p3 > 0 ? (now / p3 - 1) * 100 : null,
  };
}
