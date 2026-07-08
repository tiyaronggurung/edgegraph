import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { fetchPolymarketBtcOdds } from "@/lib/polymarketOdds.functions";

type Odds = Awaited<ReturnType<typeof fetchPolymarketBtcOdds>>;

export function PolymarketChip() {
  const fetchFn = useServerFn(fetchPolymarketBtcOdds);
  const [odds, setOdds] = useState<Odds>(null);
  const [prev, setPrev] = useState<Odds>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);

  // Poll every 2s to feel live. Cache is 2s server-side too.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchFn();
        if (cancelled) return;
        setLastFetchMs(Date.now());
        setOdds((cur) => {
          if (r && cur) {
            const dUp = r.upProb - cur.upProb;
            if (Math.abs(dUp) >= 0.005) {
              setFlash(dUp > 0 ? "up" : "down");
              setTimeout(() => setFlash(null), 1000);
              setPrev(cur);
            }
          } else if (r && !cur) {
            setPrev(r);
          }
          return r;
        });
      } catch {
        if (!cancelled) setOdds(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    tick();
    const id = setInterval(tick, 2_000);
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
        title="Polymarket 5-min BTC Up/Down odds unavailable (no active window or API blocked). Flip gate fails open."
      >
        Poly: offline
      </span>
    );
  }
  const up = odds.upProb * 100;
  const down = odds.downProb * 100;
  const dUp = prev ? (odds.upProb - prev.upProb) * 100 : 0;
  const secsLeft = Math.max(0, Math.floor((odds.windowEndMs - nowMs) / 1000));
  const mm = Math.floor(secsLeft / 60);
  const ss = String(secsLeft % 60).padStart(2, "0");
  const ageSec = lastFetchMs ? Math.max(0, Math.floor((nowMs - lastFetchMs) / 1000)) : 0;
  const dotCls =
    ageSec <= 3 ? "bg-emerald-400 animate-pulse" :
    ageSec <= 8 ? "bg-amber-400" : "bg-red-400";
  const flashCls =
    flash === "up" ? "ring-1 ring-emerald-400/60" :
    flash === "down" ? "ring-1 ring-red-400/60" : "";
  const bid = odds.bestBid > 0 ? (odds.bestBid * 100).toFixed(1) : null;
  const ask = odds.bestAsk > 0 ? (odds.bestAsk * 100).toFixed(1) : null;
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 font-mono flex items-center gap-1 transition-all ${flashCls}`}
      title={`Polymarket ${odds.slug} · ${bid && ask ? `Up bid ${bid}¢ / ask ${ask}¢ · ` : ""}window ends in ${mm}:${ss} · fetched ${ageSec}s ago${prev ? ` · Δup ${dUp >= 0 ? "+" : ""}${dUp.toFixed(2)}pt` : ""}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
      <span className="text-muted-foreground">Poly</span>
      <span className="text-emerald-400 font-semibold">↑{up.toFixed(1)}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-red-400 font-semibold">↓{down.toFixed(1)}</span>
      {prev && Math.abs(dUp) >= 0.05 && (
        <span className={dUp >= 0 ? "text-emerald-400" : "text-red-400"}>
          {dUp >= 0 ? "▲" : "▼"}{Math.abs(dUp).toFixed(2)}
        </span>
      )}
      <span className="text-muted-foreground tabular-nums">· {mm}:{ss}</span>
    </span>
  );
}
