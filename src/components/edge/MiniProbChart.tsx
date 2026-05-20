export function MiniProbChart({
  series,
  width = 280,
  height = 80,
  color = "var(--color-primary)",
}: {
  series: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!series.length) return null;
  const min = 0;
  const max = 100;
  const step = width / Math.max(1, series.length - 1);
  const points = series.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / (max - min)) * height;
    return [x, y] as const;
  });
  const d = points.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  const gradId = `g-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}
