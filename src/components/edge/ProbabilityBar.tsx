export function ProbabilityBar({
  a,
  b,
  draw,
  labelA = "A",
  labelB = "B",
  labelDraw = "Draw",
}: {
  a: number;
  b: number;
  /** When provided, renders a 3-segment bar (A / Draw / B). */
  draw?: number;
  labelA?: string;
  labelB?: string;
  labelDraw?: string;
}) {
  const hasDraw = typeof draw === "number" && Number.isFinite(draw);
  const total = hasDraw ? a + (draw as number) + b || 1 : a + b || 1;
  const aPct = (a / total) * 100;
  const drawPct = hasDraw ? ((draw as number) / total) * 100 : 0;
  const bPct = (b / total) * 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground font-mono gap-2">
        <span className="text-[color:var(--color-primary)] truncate">
          {labelA} {a.toFixed(1)}%
        </span>
        {hasDraw && (
          <span className="text-[color:var(--color-warning,#f59e0b)] truncate">
            {labelDraw} {(draw as number).toFixed(1)}%
          </span>
        )}
        <span className="text-[color:var(--color-info)] truncate">
          {labelB} {b.toFixed(1)}%
        </span>
      </div>
      <div className="h-3 w-full bg-muted rounded overflow-hidden flex border border-border">
        <div
          className="h-full bg-[color:var(--color-primary)]"
          style={{ width: `${aPct}%`, boxShadow: "0 0 12px var(--color-primary)" }}
        />
        {hasDraw && (
          <div
            className="h-full bg-[color:var(--color-warning,#f59e0b)]"
            style={{ width: `${drawPct}%`, boxShadow: "0 0 12px var(--color-warning,#f59e0b)" }}
          />
        )}
        <div
          className="h-full bg-[color:var(--color-info)]"
          style={{ width: `${bPct}%`, boxShadow: "0 0 12px var(--color-info)" }}
        />
      </div>
    </div>
  );
}
