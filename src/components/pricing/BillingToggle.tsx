import { cn } from "@/lib/utils";
import type { BillingInterval } from "@/lib/plans/config";

interface Props {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}

export function BillingToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center border border-border bg-card rounded p-1 font-mono">
      <button
        onClick={() => onChange("month")}
        className={cn(
          "px-4 py-1.5 text-xs uppercase tracking-wider rounded transition",
          value === "month"
            ? "bg-[color:var(--color-primary)]/15 text-[color:var(--color-primary)]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Monthly
      </button>
      <button
        onClick={() => onChange("year")}
        className={cn(
          "px-4 py-1.5 text-xs uppercase tracking-wider rounded transition flex items-center gap-2",
          value === "year"
            ? "bg-[color:var(--color-primary)]/15 text-[color:var(--color-primary)]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Annual
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[color:var(--color-primary)]/20 text-[color:var(--color-primary)]">
          Save 20%
        </span>
      </button>
    </div>
  );
}
