import type { KalshiSentiment } from "@/lib/kalshiSentiment";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

// Compact Kalshi sentiment badge — shows market's implied P(up) for the
// current 15-min window. Informational; drives the optional Sentiment Gate.
export function KalshiSentimentBadge({ s, compact = false }: { s: KalshiSentiment; compact?: boolean }) {
  const color =
    !s.ready ? "border-border bg-muted/20 text-muted-foreground" :
    s.isChop ? "border-border bg-muted/20 text-muted-foreground" :
    s.bias === "up"   ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" :
    s.bias === "down" ? "border-red-500/40 bg-red-500/10 text-red-300" :
    "border-border bg-muted/20 text-muted-foreground";
  const Icon = s.bias === "up" ? ArrowUp : s.bias === "down" ? ArrowDown : Minus;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`}
        title={s.reason}
      >
        <Icon className="h-2.5 w-2.5" />
        Kalshi {s.ready && s.atmYesPct != null ? `${s.atmYesPct.toFixed(0)}¢` : "…"}
      </span>
    );
  }

  return (
    <div className={`text-[11px] px-2 py-1.5 rounded border ${color} font-mono`} title={s.reason}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span className="font-semibold uppercase tracking-wider text-[10px]">Kalshi</span>
        <span className="ml-auto text-sm font-bold">{s.ready && s.atmYesPct != null ? `${s.atmYesPct.toFixed(0)}¢` : "…"}</span>
      </div>
      <div className="text-[10px] opacity-80 mt-0.5">
        {s.strengthLabel}{s.ready && s.bias !== "flat" ? ` ${s.bias}` : ""}
      </div>
      <div className="text-[10px] opacity-70 mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
        {s.reason}
      </div>
    </div>
  );
}
