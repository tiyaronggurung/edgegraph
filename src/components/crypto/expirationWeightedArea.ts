type AreaPoint = { t: number; up: number };

/** Presentation only. Integrate both lines from zero with weight
 * 1 / sqrt(seconds until the fixed window close). Do not extrapolate missing
 * recordings; retain the chart's 10-second maximum credited interval.
 * The one-second floor keeps the weight finite at the closing bell. */
export function expirationWeightedArea(points: AreaPoint[], windowStart: number) {
  const windowClose = windowStart + 900_000;
  let upArea = 0;
  let totalWeight = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (!Number.isFinite(previous.t) || !Number.isFinite(current.t)
      || !Number.isFinite(previous.up) || !Number.isFinite(current.up)
      || previous.t < windowStart || current.t > windowClose) continue;
    const dt = Math.min(10, Math.max(0, (current.t - previous.t) / 1000));
    if (dt === 0) continue;
    const midpoint = (previous.t + current.t) / 2;
    const secondsLeft = Math.max(1, (windowClose - midpoint) / 1000);
    const weight = dt / Math.sqrt(secondsLeft);
    const up = (Math.min(1, Math.max(0, previous.up)) + Math.min(1, Math.max(0, current.up))) / 2;
    upArea += up * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return null;
  const upPct = upArea / totalWeight * 100;
  return { upPct, downPct: 100 - upPct };
}