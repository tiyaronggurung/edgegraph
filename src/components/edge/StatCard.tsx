import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: "primary" | "info" | "warning" | "danger";
  className?: string;
}) {
  const accentClass = {
    primary: "text-[color:var(--color-primary)]",
    info: "text-[color:var(--color-info)]",
    warning: "text-[color:var(--color-warning)]",
    danger: "text-[color:var(--color-destructive)]",
  }[accent ?? "primary"];
  return (
    <div className={cn("border border-border bg-card rounded-md p-4 flex flex-col gap-2", className)}>
      <span className="terminal-label">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums", accentClass)}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}
