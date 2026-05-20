import { cn } from "@/lib/utils";

export function Edge70Badge({ detected, className }: { detected: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-widest",
        detected
          ? "bg-[oklch(0.86_0.22_155/0.15)] text-[color:var(--color-primary)] border-[color:var(--color-primary)] neon-text"
          : "bg-[oklch(0.64_0.22_25/0.1)] text-[color:var(--color-destructive)] border-[color:var(--color-destructive)]",
        className,
      )}
    >
      {detected ? "⚡ Edge70 Detected" : "✗ No Edge70"}
    </span>
  );
}
