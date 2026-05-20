import { cn } from "@/lib/utils";
import type { ActionType } from "@/lib/analysisEngine";

const STYLES: Record<ActionType, string> = {
  Bet: "bg-[oklch(0.86_0.22_155/0.15)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]",
  Wait: "bg-[oklch(0.62_0.19_254/0.15)] text-[color:var(--color-info)] border-[color:var(--color-info)]",
  Hedge: "bg-[oklch(0.78_0.16_70/0.15)] text-[color:var(--color-warning)] border-[color:var(--color-warning)]",
  Avoid: "bg-[oklch(0.64_0.22_25/0.15)] text-[color:var(--color-destructive)] border-[color:var(--color-destructive)]",
  "Watch Only": "bg-muted text-muted-foreground border-border",
};

export function ActionBadge({ action, className }: { action: ActionType; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-bold uppercase tracking-wider",
        STYLES[action],
        className,
      )}
    >
      {action}
    </span>
  );
}
