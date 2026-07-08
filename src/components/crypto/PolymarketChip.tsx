import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { fetchPolymarketBtcOdds } from "@/lib/polymarketOdds.functions";

type Odds = Awaited<ReturnType<typeof fetchPolymarketBtcOdds>>;

export function PolymarketChip() {
  const fetchFn = useServerFn(fetchPolymarketBtcOdds);
  const [odds, setOdds] = useState<Odds>(null);
  const prevRef = useRef<Odds>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);

  // Poll every 1s — CLOB midpoint updates in near-realtime.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchFn();
        if (cancelled) return;
        setLastFetchMs(Date.now());
        if (r) {
          const p = prevRef.current;
          if (p) {
            const dUp = r.upProb - p.upProb;
            if (Math.abs(dUp) >= 0.001) {
              setFlash(dUp > 0 ? "up" : "down");
              setTimeout(() => setFlash(null), 800);
            }
          }
          prevRef.current = r;
        }
        setOdds(r);
      } catch {
        if (!cancelled) setOdds(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    tick();
    const id = setInterval(tick, 1_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchFn]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  if (loading && !odds) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground font-mono">
        Poly: connecting…
      </span>
    );
  }
  if (!odds) {
    return (
      <span
        className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground font-mono"
        title="Polymarket 5-min BTC Up/Down offline (no active window or API blocked). Flip gate fails open."
      >
        Poly: offline
      </span>
    );
  }
  const up = odds.upProb * 100;
  const down = odds.downProb * 100;
  const bid = odds.bestBid * 100;
  const ask = odds.bestAsk * 100;
  const last = odds.lastTrade * 100;
  const p = prevRef.current;
  const dUp = p ? (odds.upProb - p.upProb) * 100 : 0;
  const secsLeft = Math.max(0, Math.floor((odds.windowEndMs - nowMs) / 1000));
  const mm = Math.floor(secsLeft / 60);
  const ss = String(secsLeft % 60).padStart(2, "0");
  const ageSec = lastFetchMs ? Math.max(0, Math.floor((nowMs - lastFetchMs) / 1000)) : 0;
  const dotCls =
    ageSec <= 2 ? "bg-emerald-400 animate-pulse" :
    ageSec <= 5 ? "bg-amber-400" : "bg-red-400";
  const flashCls =
    flash === "up" ? "ring-1 ring-emerald-400/70" :
    flash === "down" ? "ring-1 ring-red-400/70" : "";
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 font-mono flex items-center gap-1 transition-all ${flashCls}`}
      title={`Polymarket ${odds.slug} · Up mid ${up.toFixed(2)}¢ · bid ${bid.toFixed(1)}¢ / ask ${ask.toFixed(1)}¢${last > 0 ? ` · last ${last.toFixed(1)}¢` : ""} · fetched ${ageSec}s ago · window closes in ${mm}:${ss}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
      <span className="text-muted-foreground">Poly mid</span>
      <span className="text-emerald-400 font-semibold tabular-nums">↑{up.toFixed(2)}¢</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-red-400 font-semibold tabular-nums">↓{down.toFixed(2)}¢</span>
      {p && Math.abs(dUp) >= 0.01 && (
        <span className={dUp >= 0 ? "text-emerald-400" : "text-red-400"}>
          {dUp >= 0 ? "▲" : "▼"}{Math.abs(dUp).toFixed(2)}
        </span>
      )}
      <span className="text-muted-foreground tabular-nums">
        · b{bid.toFixed(0)}/a{ask.toFixed(0)}
      </span>
      <span className="text-muted-foreground tabular-nums">· {mm}:{ss}</span>
    </span>
  );
}
