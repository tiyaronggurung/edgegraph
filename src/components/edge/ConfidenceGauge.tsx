export function ConfidenceGauge({ value, size = 160 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const cx = size / 2;
  const cy = size / 2 + size * 0.05;
  const r = size * 0.4;
  // semicircle from 180° to 360°
  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;
  const angle = startAngle + (endAngle - startAngle) * (v / 100);
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const px = cx + r * Math.cos(angle);
  const py = cy + r * Math.sin(angle);

  const color = v >= 80 ? "var(--color-primary)" : v >= 60 ? "var(--color-info)" : v >= 40 ? "var(--color-warning)" : "var(--color-destructive)";

  return (
    <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`}>
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
        stroke="var(--color-border)"
        strokeWidth={size * 0.06}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${angle - startAngle > Math.PI ? 1 : 0} 1 ${px} ${py}`}
        stroke={color}
        strokeWidth={size * 0.06}
        fill="none"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      <text
        x={cx}
        y={cy - size * 0.05}
        textAnchor="middle"
        fontSize={size * 0.22}
        fontWeight="700"
        fill={color}
        fontFamily="var(--font-mono)"
      >
        {Math.round(v)}%
      </text>
      <text
        x={cx}
        y={cy + size * 0.1}
        textAnchor="middle"
        fontSize={size * 0.07}
        fill="var(--color-muted-foreground)"
        fontFamily="var(--font-mono)"
        letterSpacing="0.15em"
      >
        CONFIDENCE
      </text>
    </svg>
  );
}
