import { useEffect, useRef, useState } from "react";

// Binance USDT-M futures forced-liquidation stream (all symbols).
// We only keep BTCUSDT events, in a 5-min rolling buffer.
//
// Each Binance forceOrder event carries the LIQUIDATED side:
//   - side="SELL" → a LONG position was liquidated (forced market-sell)
//   - side="BUY"  → a SHORT position was liquidated (forced market-buy)
//
// Cluster detector: sum notional per side in the last 60s. Big longs-liquidated
// cluster = capitulation → short-term bounce likely (bullish reversal signal).
// Big shorts-liquidated cluster = short squeeze → continuation up.
//
// Threshold: $5M in 60s (tunable). Below that we treat it as "chop".

export interface LiqEvent {
  t: number;
  side: "long" | "short"; // which side got liquidated
  qty: number;
  price: number;
  notional: number;       // qty * price
}

export interface LiqStream {
  connected: boolean;
  events: LiqEvent[];
  longsLiq60sUsd: number;   // longs liquidated in last 60s ($)
  shortsLiq60sUsd: number;  // shorts liquidated in last 60s ($)
  bias: "long-cap" | "short-squeeze" | "neutral";
  strength: "strong" | "moderate" | "neutral";
  reason: string;
}

const KEEP_MS = 5 * 60_000;
const CLUSTER_WINDOW_MS = 60_000;
const CLUSTER_STRONG_USD = 5_000_000;
const CLUSTER_MOD_USD = 1_500_000;

export function useBinanceLiquidations(): LiqStream {
  const bufRef = useRef<LiqEvent[]>([]);
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
        ws = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr");
        ws.onopen = () => { if (!cancelled) setConnected(true); };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            const o = msg?.o;
            if (!o || o.s !== "BTCUSDT") return;
            const qty = parseFloat(o.q);
            const price = parseFloat(o.ap ?? o.p);
            const t = Number(o.T ?? Date.now());
            if (!Number.isFinite(qty) || !Number.isFinite(price)) return;
            const side: "long" | "short" = o.S === "SELL" ? "long" : "short";
            const buf = bufRef.current;
            buf.push({ t, side, qty, price, notional: qty * price });
            const cutoff = Date.now() - KEEP_MS;
            while (buf.length && buf[0].t < cutoff) buf.shift();
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

    flushTimer = setInterval(() => { if (!cancelled) setTick(x => x + 1); }, 2000);
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearInterval(flushTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  void tick;
  const now = Date.now();
  const cutoff = now - CLUSTER_WINDOW_MS;
  let longsUsd = 0, shortsUsd = 0;
  for (const e of bufRef.current) {
    if (e.t < cutoff) continue;
    if (e.side === "long") longsUsd += e.notional;
    else shortsUsd += e.notional;
  }
  const dominant = longsUsd > shortsUsd ? "long-cap" : shortsUsd > longsUsd ? "short-squeeze" : "neutral";
  const dominantUsd = Math.max(longsUsd, shortsUsd);
  const strength: "strong" | "moderate" | "neutral" =
    dominantUsd >= CLUSTER_STRONG_USD ? "strong" :
    dominantUsd >= CLUSTER_MOD_USD ? "moderate" : "neutral";
  const bias: "long-cap" | "short-squeeze" | "neutral" =
    strength === "neutral" ? "neutral" : (dominant as "long-cap" | "short-squeeze");

  const fmt = (n: number) => n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`;
  const reason =
    bias === "neutral" ? `quiet — longs ${fmt(longsUsd)} / shorts ${fmt(shortsUsd)} in 60s` :
    bias === "long-cap" ? `${strength} long-liq cluster ${fmt(longsUsd)} in 60s — bounce risk` :
    `${strength} short-squeeze ${fmt(shortsUsd)} in 60s — continuation up`;

  return {
    connected,
    events: bufRef.current,
    longsLiq60sUsd: longsUsd,
    shortsLiq60sUsd: shortsUsd,
    bias, strength, reason,
  };
}
