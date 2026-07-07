import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/ta/chartSignals";

// Binance REST klines poller. 1m and 5m BTCUSDT candles, last 4h of history.
// Read-only — feeds the shadow TA engine. Not tied to any live trading path.
interface Options {
  intervalMs?: number; // poll cadence
}

async function fetchKlines(interval: "1m" | "5m", limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${interval} ${res.status}`);
  const raw = (await res.json()) as unknown[];
  return raw.map((row) => {
    const r = row as [number, string, string, string, string, string];
    return {
      t: Number(r[0]),
      o: parseFloat(r[1]),
      h: parseFloat(r[2]),
      l: parseFloat(r[3]),
      c: parseFloat(r[4]),
      v: parseFloat(r[5]),
    } satisfies Candle;
  });
}

export function useBinanceBtcCandles({ intervalMs = 15_000 }: Options = {}) {
  const [candles1m, setC1] = useState<Candle[]>([]);
  const [candles5m, setC5] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchMs, setLastFetch] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [c1, c5] = await Promise.all([
          fetchKlines("1m", 240), // 4h
          fetchKlines("5m", 48),  // 4h
        ]);
        if (cancelled) return;
        setC1(c1);
        setC5(c5);
        setError(null);
        setLastFetch(Date.now());
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    load();
    timer.current = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [intervalMs]);

  return { candles1m, candles5m, error, lastFetchMs };
}
