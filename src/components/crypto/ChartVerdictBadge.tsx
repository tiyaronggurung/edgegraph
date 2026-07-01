import { useChartVerdict } from "@/hooks/useChartVerdict";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

// Compact chart-verdict badge for the auto-trade panel.
// Purely informational + drives the optional "chart gate" on auto-martingale.
export function ChartVerdictBadge({ compact = false }: { compact?: boolean }) {
  const v = useChartVerdict();
  const skew = v.score - 50;
  const color =
    v.strength === "chop" ? "border-border bg-muted/20 text-muted-foreground" :
    v.bias === "up"   ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" :
    v.bias === "down" ? "border-red-500/40 bg-red-500/10 text-red-300" :
    "border-border bg-muted/20 text-muted-foreground";
  const Icon = v.bias === "up" ? ArrowUp : v.bias === "down" ? ArrowDown : Minus;

  const tip = v.ready
    ? [
        `Chart ${v.score.toFixed(0)}/100 · ${v.strength} ${v.bias}`,
        v.reason,
        v.markPrice != null ? `Futures: ${v.futuresReason}` : null,
        v.liqConnected ? `Liq (60s): ${v.liqReason}` : null,
        v.htfReady ? `HTF: ${v.htfReason}` : null,
        v.ethConnected ? `ETH: ${v.ethReason}` : null,
      ].filter(Boolean).join("\n")
    : v.reason;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`}
        title={tip}
      >
        <Icon className="h-2.5 w-2.5" />
        Chart {v.ready ? v.score.toFixed(0) : "…"}
      </span>
    );
  }


  return (
    <div className={`text-[11px] px-2 py-1.5 rounded border ${color} font-mono`} title={v.reason}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span className="font-semibold uppercase tracking-wider text-[10px]">Chart</span>
        <span className="ml-auto text-sm font-bold">{v.ready ? v.score.toFixed(0) : "…"}</span>
      </div>
      <div className="text-[10px] opacity-80 mt-0.5">
        {v.strength}{v.ready && ` ${v.bias}`} · skew {skew >= 0 ? "+" : ""}{skew.toFixed(0)}
      </div>
      <div className="text-[10px] opacity-70 mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
        {v.reason}
      </div>
      {v.support && v.resistance && (
        <div className="text-[10px] opacity-60 mt-0.5">
          S ${v.support.toFixed(0)} / R ${v.resistance.toFixed(0)}
        </div>
      )}
    </div>
  );
}
