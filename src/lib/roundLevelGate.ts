// Phase 4 — Round-number magnet gate.
//
// Round dollar levels ($100 majors, $50 minors) act as magnets/S-R.
// When spot is glued to a round level, price often reverts back to it
// even if directional signals point away. This gate blocks a fire against
// the magnet unless we see a confirmed break: N consecutive short-frame
// closes on the far side of the level.
//
// Pure function — no React, no side effects. Callers pass their own tick
// buffer. Same-turn call is idempotent.

export interface MagnetCheck {
  skip: boolean;
  reason: string;
  nearestLevel: number | null;
  distanceBps: number | null;
}

export interface Tick { t: number; p: number }

export interface MagnetOptions {
  major?: number;   // major-level spacing in dollars, default 100
  minor?: number;   // minor-level spacing in dollars, default 50
  beltBps?: number; // "glued" threshold in bps, default 5 (~$5 at $100k)
  breakBars?: number; // # of consecutive 15s closes required to confirm break, default 3
  barMs?: number;   // frame size, default 15_000
}

export function shouldSkipForMagnet(
  price: number,
  side: "up" | "down",
  ticks: Tick[],
  opts: MagnetOptions = {},
): MagnetCheck {
  const major = opts.major ?? 100;
  const minor = opts.minor ?? 50;
  const beltBps = opts.beltBps ?? 5;
  const breakBars = opts.breakBars ?? 3;
  const barMs = opts.barMs ?? 15_000;

  if (!Number.isFinite(price) || price <= 0) {
    return { skip: false, reason: "no price", nearestLevel: null, distanceBps: null };
  }

  const majorNearest = Math.round(price / major) * major;
  const minorNearest = Math.round(price / minor) * minor;
  const majorDist = Math.abs(price - majorNearest);
  const minorDist = Math.abs(price - minorNearest);
  const [level, dist] = majorDist <= minorDist ? [majorNearest, majorDist] : [minorNearest, minorDist];
  const distBps = (dist / price) * 10_000;

  if (distBps > beltBps) {
    return { skip: false, reason: `off magnet (${distBps.toFixed(1)} bps)`, nearestLevel: level, distanceBps: distBps };
  }
  // We're in the belt. Fire against the magnet only if we've confirmed a
  // break in our direction.
  //   - side=up: we want price to rise → we fire "against" the magnet only
  //     if the magnet sits ABOVE current price (acting as a cap/resistance).
  //     A confirmed break needs the last N bars closing ABOVE level.
  //   - side=down: mirror.
  const magnetAbove = level >= price;
  const magnetBelow = level <= price;

  // Build 15s closes over last (breakBars + 1) frames
  const now = ticks.length ? ticks[ticks.length - 1].t : Date.now();
  const windows = breakBars;
  const closes: number[] = [];
  for (let i = windows - 1; i >= 0; i--) {
    const endT = now - i * barMs;
    const startT = endT - barMs;
    let close: number | null = null;
    for (let j = ticks.length - 1; j >= 0; j--) {
      if (ticks[j].t > endT) continue;
      if (ticks[j].t < startT) break;
      if (close == null) close = ticks[j].p;
    }
    if (close != null) closes.push(close);
  }
  if (closes.length < windows) {
    return { skip: true, reason: `in belt @ $${level} — need ${windows} bars to confirm break`, nearestLevel: level, distanceBps: distBps };
  }
  const brokeUp = closes.every(c => c > level);
  const brokeDown = closes.every(c => c < level);

  if (side === "up" && magnetAbove && !brokeUp) {
    return { skip: true, reason: `magnet $${level} above · not broken (${closes.map(c => c.toFixed(0)).join(",")})`, nearestLevel: level, distanceBps: distBps };
  }
  if (side === "down" && magnetBelow && !brokeDown) {
    return { skip: true, reason: `magnet $${level} below · not broken (${closes.map(c => c.toFixed(0)).join(",")})`, nearestLevel: level, distanceBps: distBps };
  }
  return { skip: false, reason: `magnet $${level} cleared`, nearestLevel: level, distanceBps: distBps };
}
