import { useEffect, useRef, useState } from "react";

// Bitstamp public WebSocket — BTC/USD live trades.
// Free, no auth, no CORS. Bitstamp is a CF BRR constituent, which is the
// index family closest to Kalshi's BTC settlement — pulling it into the
// composite tightens us against Kalshi's reference in the last minute.
export interface BitstampBtcSpot {
  price: number | null;
  lastTickMs: number | null;
  connected: boolean;
}

export function useBitstampBtcSpot(): BitstampBtcSpot {
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
        const ws = new WebSocket("wss://ws.bitstamp.net");
        wsRef.current = ws;
        ws.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          ws.send(JSON.stringify({
            event: "bts:subscribe",
            data: { channel: "live_trades_btcusd" },
          }));
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.event !== "trade") return;
            const p = Number(msg.data?.price);
            if (Number.isFinite(p) && p > 0) {
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

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  return { price, lastTickMs, connected };
}
