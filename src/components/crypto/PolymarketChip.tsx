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

  // Poll every 5s. Fresh 5-min window data + fast crowd rotation detection.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchFn();
        if (cancelled) return;
        setOdds((cur) => {
          if (r && cur) {
            const dUp = r.upProb - cur.upProb;
            if (Math.abs(dUp) >= 0.02) {
              setFlash(dUp > 0 ? "up" : "down");
              setTimeout(() => setFlash(null), 1200);
            }
            setPrev(cur);
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
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchFn]);

  // Tick clock every second so the countdown/PS values feel live.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading && !odds) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground font-mono">
        Poly: …
      </span>
    );
  }
  if (!odds) {
    return (
      <span
        className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground font-mono"
        title="Polymarket 5-min BTC Up/Down odds unavailable (no active window or API error). Flip gate fails open."
      >
        Poly: n/a
      </span>
    );
  }
  const up = odds.upProb * 100;
  const down = odds.downProb * 100;
  const dUp = prev ? (odds.upProb - prev.upProb) * 100 : 0;
  const secsLeft = Math.max(0, Math.floor((odds.windowEndMs - nowMs) / 1000));
  const mm = Math.floor(secsLeft / 60);
  const ss = String(secsLeft % 60).padStart(2, "0");
  const leaning = up > down ? "UP" : down > up ? "DOWN" : "FLAT";
  const flashCls =
    flash === "up" ? "ring-1 ring-emerald-400/60" :
    flash === "down" ? "ring-1 ring-red-400/60" : "";
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 font-mono flex items-center gap-1 transition-all ${flashCls}`}
      title={`Polymarket 5-min BTC ${odds.slug} · window ends in ${mm}:${ss} · leaning ${leaning}${prev ? ` · Δup ${dUp >= 0 ? "+" : ""}${dUp.toFixed(1)}pt` : ""}`}
    >
      <span className="text-muted-foreground">Poly</span>
      <span className="text-emerald-400 font-semibold">↑{up.toFixed(1)}%</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-red-400 font-semibold">↓{down.toFixed(1)}%</span>
      {prev && Math.abs(dUp) >= 0.1 && (
        <span className={dUp >= 0 ? "text-emerald-400" : "text-red-400"}>
          {dUp >= 0 ? "▲" : "▼"}{Math.abs(dUp).toFixed(1)}
        </span>
      )}
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums">{mm}:{ss}</span>
    </span>
  );
}
