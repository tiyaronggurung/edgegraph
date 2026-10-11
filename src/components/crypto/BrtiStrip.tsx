import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBrtiSpot } from "@/lib/brtiSpot.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { cn } from "@/lib/utils";

// Kalshi's settlement index vs our composite spot. Display only.
export function BrtiStrip() {
  const fn = useServerFn(getBrtiSpot);
  const live = useLiveCompositeSpot();
  const { data } = useQuery({
    queryKey: ["brti-spot"],
    queryFn: () => fn(),
    refetchInterval: 1_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const fmt = (n: number | null | undefined, digits = 2) =>
    n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const price = data?.price ?? null;
  const avg60 = data?.avg60 ?? null;
  const spot = live.spot;
  const gap = price != null && spot != null ? spot - price : null;
  const gapPct = gap != null && price ? (gap / price) * 100 : null;
  const nowMinusAvg = price != null && avg60 != null ? price - avg60 : null;
  const up = nowMinusAvg != null && nowMinusAvg >= 0;

  return (
    <div className="neon-border grid-bg relative overflow-hidden rounded-lg bg-card/90 px-4 py-3">
      {/* header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60"
              style={{ animationDuration: "2s" }}
            />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="terminal-label font-semibold">Kalshi settlement index · BRTI</span>
        </div>
        <span className="terminal-label">1s updates</span>
      </div>

      {/* main strip */}
      <div className="mt-2.5 flex flex-wrap items-end gap-x-6 gap-y-3">
        {/* BRTI now */}
        <div className="min-w-[140px]">
          <div className="terminal-label">BRTI now</div>
          <div className="neon-text mt-0.5 text-2xl font-bold tabular-nums leading-none">${fmt(price)}</div>
          {nowMinusAvg != null && (
            <div
              className={cn(
                "mt-1 text-[10px] font-medium tabular-nums",
                up ? "text-success" : "text-destructive",
              )}
            >
              {up ? "▲" : "▼"} ${fmt(Math.abs(nowMinusAvg))} vs settle avg
            </div>
          )}
        </div>

        {/* 60s avg — the number that settles */}
        <div className="min-w-[150px] rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <div className="terminal-label text-primary/80">60s avg · settles on</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums leading-none text-primary">${fmt(avg60)}</div>
        </div>

        {/* our spot */}
        <div className="min-w-[140px]">
          <div className="terminal-label">Our composite spot</div>
          <div className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-foreground">${fmt(spot)}</div>
        </div>

        {/* gap */}
        <div className="min-w-[130px]">
          <div className="terminal-label">Gap (ours − BRTI)</div>
          <div
            className={cn(
              "mt-0.5 text-xl font-bold tabular-nums leading-none",
              gap == null ? "text-muted-foreground" : gap >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {gap == null ? "—" : `${gap >= 0 ? "+" : "−"}$${fmt(Math.abs(gap))}`}
            {gapPct != null && (
              <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                {gapPct >= 0 ? "+" : "−"}
                {Math.abs(gapPct).toFixed(3)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
