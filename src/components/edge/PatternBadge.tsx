import { cn } from "@/lib/utils";

export function PatternBadge({
  pattern,
  icon,
  className,
}: {
  pattern: string;
  icon?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-card text-xs font-mono",
        className,
      )}
    >
      {icon && <span>{icon}</span>}
      <span className="uppercase tracking-wider">{pattern}</span>
    </span>
  );
}
