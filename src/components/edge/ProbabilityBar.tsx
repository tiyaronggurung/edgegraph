export function ProbabilityBar({
  a,
  b,
  labelA = "A",
  labelB = "B",
}: {
  a: number;
  b: number;
  labelA?: string;
  labelB?: string;
}) {
  const total = a + b || 1;
  const aPct = (a / total) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground font-mono">
        <span className="text-[color:var(--color-primary)]">{labelA} {a.toFixed(1)}%</span>
        <span className="text-[color:var(--color-info)]">{labelB} {b.toFixed(1)}%</span>
      </div>
      <div className="h-3 w-full bg-muted rounded overflow-hidden flex border border-border">
        <div
          className="h-full bg-[color:var(--color-primary)]"
          style={{ width: `${aPct}%`, boxShadow: "0 0 12px var(--color-primary)" }}
        />
        <div
          className="h-full bg-[color:var(--color-info)]"
          style={{ width: `${100 - aPct}%`, boxShadow: "0 0 12px var(--color-info)" }}
        />
      </div>
    </div>
  );
}
