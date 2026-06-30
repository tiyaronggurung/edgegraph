import { useEffect, useRef, useState } from "react";

// Real-time BTC/USDT spot from Binance public WebSocket.
// No auth, no CORS, pushes on every trade (~50-100ms latency).
// Falls back silently to null on connection issues.
export interface BinanceBtcSpot {
  price: number | null;
  prevPrice: number | null;
  direction: "up" | "down" | "flat";
  lastTickMs: number | null;
  connected: boolean;
}

export function useBinanceBtcSpot(): BinanceBtcSpot {
  const [price, setPrice] = useState<number | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [direction, setDirection] = useState<"up" | "down" | "flat">("flat");
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const lastRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      try {
        const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");
        wsRef.current = ws;
        ws.onopen = () => { if (!cancelled) setConnected(true); };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            const p = parseFloat(msg.p);
            if (Number.isFinite(p)) {
              const last = lastRef.current;
              if (last != null && p !== last) {
                setPrevPrice(last);
                setDirection(p > last ? "up" : "down");
              }
              lastRef.current = p;
              setPrice(p);
              setLastTickMs(Date.now());
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => { setConnected(false); };
        ws.onclose = () => {
          setConnected(false);
          if (!cancelled) {
            reconnectTimer.current = setTimeout(connect, 2000);
          }
        };
      } catch {
        if (!cancelled) reconnectTimer.current = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return { price, prevPrice, direction, lastTickMs, connected };
}
