import { useEffect, useRef, useState } from "react";

// Binance USDT-M futures snapshot for BTCUSDT perpetual.
// Combines:
//   - markPrice WS (1s cadence): perp mark + funding rate
//   - openInterest REST (30s poll): OI level + rolling delta
//
// Kept minimal + independent so it can't destabilize the spot feed. All fields
// are nullable until the first message arrives.

export interface BtcFutures {
  connected: boolean;
  markPrice: number | null;
  fundingRate: number | null;      // e.g. 0.0001 = 0.01% per 8h window
  fundingBiasPct: number | null;    // fundingRate * 100 for display
  openInterest: number | null;      // BTC contracts open
  oiDelta5mPct: number | null;      // % change in OI vs 5 min ago
  lastUpdateMs: number | null;
}

interface OISample { t: number; oi: number }

const OI_POLL_MS = 30_000;
const OI_KEEP_MS = 6 * 60_000; // keep 6 min so we can compare vs ~5 min ago

export function useBinanceBtcFutures(): BtcFutures {
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [openInterest, setOpenInterest] = useState<number | null>(null);
  const [oiDelta5mPct, setOiDelta5mPct] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(null);
  const oiBufRef = useRef<OISample[]>([]);

  // WS: markPrice + funding
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket("wss://fstream.binance.com/ws/btcusdt@markPrice@1s");
        ws.onopen = () => { if (!cancelled) setConnected(true); };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            const p = parseFloat(m.p);
            const r = parseFloat(m.r);
            if (Number.isFinite(p)) setMarkPrice(p);
            if (Number.isFinite(r)) setFundingRate(r);
            setLastUpdateMs(Date.now());
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

  // REST poll: openInterest
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT");
        if (!res.ok) return;
        const j = await res.json();
        const oi = parseFloat(j.openInterest);
        if (!Number.isFinite(oi) || cancelled) return;
        const now = Date.now();
        const buf = oiBufRef.current;
        buf.push({ t: now, oi });
        const cutoff = now - OI_KEEP_MS;
        while (buf.length && buf[0].t < cutoff) buf.shift();
        setOpenInterest(oi);
        // 5-min delta
        const target = now - 5 * 60_000;
        const past = buf.find(s => s.t >= target) ?? buf[0];
        if (past && past.oi > 0) setOiDelta5mPct(((oi - past.oi) / past.oi) * 100);
      } catch { /* ignore */ }
    };

    poll();
    timer = setInterval(poll, OI_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return {
    connected,
    markPrice,
    fundingRate,
    fundingBiasPct: fundingRate != null ? fundingRate * 100 : null,
    openInterest,
    oiDelta5mPct,
    lastUpdateMs,
  };
}
