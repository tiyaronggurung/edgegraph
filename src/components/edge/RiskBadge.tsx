import { cn } from "@/lib/utils";
import type { Risk } from "@/lib/analysisEngine";

const STYLES: Record<Risk, string> = {
  Low: "border-[color:var(--color-primary)] text-[color:var(--color-primary)]",
  Medium: "border-[color:var(--color-info)] text-[color:var(--color-info)]",
  "Medium/High": "border-[color:var(--color-warning)] text-[color:var(--color-warning)]",
  High: "border-[color:var(--color-destructive)] text-[color:var(--color-destructive)]",
};

export function RiskBadge({ risk, className }: { risk: Risk | string; className?: string }) {
  const key = (["Low", "Medium", "Medium/High", "High"].includes(risk) ? risk : "Medium") as Risk;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] uppercase tracking-widest font-mono",
        STYLES[key],
        className,
      )}
    >
      Risk: {risk}
    </span>
  );
}
