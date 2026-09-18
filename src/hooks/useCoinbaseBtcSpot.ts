import { useEffect, useRef, useState } from "react";

// Coinbase Advanced Trade public feed — BTC-USD spot.
// Free, no auth, no CORS. Used as a second-venue cross-check with Binance.
// Coinbase often leads Binance on US-hours moves.
export interface CoinbaseBtcSpot {
  price: number | null;
  lastTickMs: number | null;
  connected: boolean;
}

export function useCoinbaseBtcSpot(): CoinbaseBtcSpot {
  const [price, setPrice] = useState<number | null>(null);
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      try {
        const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        wsRef.current = ws;
        ws.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          ws.send(JSON.stringify({
            type: "subscribe",
            product_ids: ["BTC-USD"],
            channels: ["ticker"],
          }));
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type !== "ticker") return;
            const p = parseFloat(msg.price);
            if (Number.isFinite(p)) {
              setPrice(p);
              setLastTickMs(Date.now());
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => { if (!cancelled) setConnected(false); };
        ws.onclose = () => {
          if (cancelled) return;
          setConnected(false);
          reconnectTimer.current = setTimeout(connect, 2000);
        };
      } catch {
        if (!cancelled) reconnectTimer.current = setTimeout(connect, 2000);
      }
    };
    connect();

    // Browsers freeze/kill background sockets. The moment the tab is visible
    // again (or the network returns) reconnect immediately instead of waiting
    // on the 2s backoff timer.
    const revive = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      connect();
    };
    document.addEventListener("visibilitychange", revive);
    window.addEventListener("focus", revive);
    window.addEventListener("online", revive);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", revive);
      window.removeEventListener("focus", revive);
      window.removeEventListener("online", revive);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return { price, lastTickMs, connected };
}
