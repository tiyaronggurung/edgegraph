import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBrtiSpot } from "@/lib/brtiSpot.functions";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";

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
  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const gap = data?.price != null && live.spot != null ? live.spot - data.price : null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <span className="font-medium text-foreground">Kalshi index (BRTI)</span>
      <span className="text-muted-foreground">Now <span className="tabular-nums text-foreground">{fmt(data?.price)}</span></span>
      <span className="text-muted-foreground">60s avg (settles on) <span className="tabular-nums text-foreground">{fmt(data?.avg60)}</span></span>
      <span className="text-muted-foreground">Our spot <span className="tabular-nums text-foreground">{fmt(live.spot)}</span></span>
      <span className="text-muted-foreground">Gap <span className="tabular-nums text-foreground">{gap == null ? "—" : `${gap >= 0 ? "+" : ""}${gap.toFixed(2)}`}</span></span>
    </div>
  );
}
