import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { fetchPolymarketBtcOdds } from "@/lib/polymarketOdds.functions";

type Odds = Awaited<ReturnType<typeof fetchPolymarketBtcOdds>>;

export function PolymarketChip() {
  const fetchFn = useServerFn(fetchPolymarketBtcOdds);
  const [odds, setOdds] = useState<Odds>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchFn();
        if (!cancelled) setOdds(r);
      } catch {
        if (!cancelled) setOdds(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchFn]);

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
        title="Polymarket 5-min BTC Up/Down odds unavailable (window not open or API error). Gate fails open."
      >
        Poly: n/a
      </span>
    );
  }
  const up = Math.round(odds.upProb * 100);
  const down = Math.round(odds.downProb * 100);
  const leaning = up > down ? "up" : down > up ? "down" : "flat";
  const secsLeft = Math.max(0, Math.floor((odds.windowEndMs - Date.now()) / 1000));
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 font-mono flex items-center gap-1"
      title={`Polymarket 5-min BTC Up/Down · slug ${odds.slug} · window ends in ${secsLeft}s · leaning ${leaning}`}
    >
      Poly: <span className="text-emerald-400">↑{up}</span> /{" "}
      <span className="text-red-400">↓{down}</span>
      <span className="text-muted-foreground">· {secsLeft}s</span>
    </span>
  );
}
