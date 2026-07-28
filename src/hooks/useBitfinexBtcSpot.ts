import { useEffect, useRef, useState } from "react";

// Bitfinex public WebSocket v2 — tBTCUSD ticker.
// Free, no auth. Adds a 5th venue to the composite so a single-venue outlier
// (Binance flash spike, Coinbase halt) can't drag our reference price.
export interface BitfinexBtcSpot {
  price: number | null;
  lastTickMs: number | null;
  connected: boolean;
}

export function useBitfinexBtcSpot(): BitfinexBtcSpot {
  const [price, setPrice] = useState<number | null>(null);
  const [lastTickMs, setLastTickMs] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chanRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      try {
        const ws = new WebSocket("wss://api-pub.bitfinex.com/ws/2");
        wsRef.current = ws;
        chanRef.current = null;
        ws.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          ws.send(JSON.stringify({
            event: "subscribe",
            channel: "ticker",
            symbol: "tBTCUSD",
          }));
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            // Subscription ack: capture chanId
            if (msg && msg.event === "subscribed" && msg.channel === "ticker") {
              chanRef.current = msg.chanId;
              return;
            }
            // Data frames: [chanId, [ ... 10 fields ... ]]
            if (Array.isArray(msg) && msg.length >= 2 && Array.isArray(msg[1])) {
              const arr = msg[1] as number[];
              // Bitfinex ticker LAST_PRICE is index 6
              const p = Number(arr[6]);
              if (Number.isFinite(p) && p > 0) {
                setPrice(p);
                setLastTickMs(Date.now());
              }
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

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return { price, lastTickMs, connected };
}
