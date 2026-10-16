type AreaPoint = { t: number; up: number };

/** Presentation only — never feed into odds or trading.
 * "50-lobe" conviction area: measures how far the UP line sits above or
 * below the 50/50 midline, weighted by 1 / sqrt(seconds until the fixed
 * window close). Each segment is integrated exactly (piecewise-linear),
 * splitting at the precise 50¢ crossing so a flip mid-interval credits each
 * side only its own lobe. Missing recordings are not extrapolated; credited
 * intervals are capped at 10 seconds. One-second floor keeps the weight
 * finite at the bell. Returns each side's share of total lobe area; when no
 * excursion from 50 has happened yet, it reads 50/50. */
export function expirationWeightedArea(points: AreaPoint[], windowStart: number) {
  const windowClose = windowStart + 900_000;
  let upLobe = 0;
  let downLobe = 0;
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
    const d0 = Math.min(1, Math.max(0, previous.up)) - 0.5;
    const d1 = Math.min(1, Math.max(0, current.up)) - 0.5;
    let pos: number;
    let neg: number;
    if (d0 >= 0 && d1 >= 0) { pos = (d0 + d1) / 2; neg = 0; }
    else if (d0 <= 0 && d1 <= 0) { pos = 0; neg = -(d0 + d1) / 2; }
    else {
      const span = Math.abs(d0) + Math.abs(d1);
      const p = Math.max(d0, d1);
      const n = -Math.min(d0, d1);
      pos = (p * p) / (2 * span);
      neg = (n * n) / (2 * span);
    }
    upLobe += pos * weight;
    downLobe += neg * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return null;
  const lobes = upLobe + downLobe;
  const upPct = lobes <= 1e-12 ? 50 : (upLobe / lobes) * 100;
  return { upPct, downPct: 100 - upPct };
}
