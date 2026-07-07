// Pure technical-analysis primitives. No state, no I/O. Called by chartVerdict.
// SHADOW-ONLY — no output of this file is wired into live trading logic.

export interface Candle {
  t: number;   // open time ms
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
}

// EMA of closes, standard formula.
export function ema(candles: Candle[], period: number): number[] {
  if (!candles.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = candles[0].c;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].c;
    prev = i === 0 ? c : c * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export type TrendDir = "up" | "down" | "flat";

// EMA9 vs EMA21 + price position. Flat when EMAs are within 0.05% of each other.
export function emaTrend(candles: Candle[]): TrendDir {
  if (candles.length < 22) return "flat";
  const e9 = ema(candles, 9);
  const e21 = ema(candles, 21);
  const price = candles[candles.length - 1].c;
  const a = e9[e9.length - 1];
  const b = e21[e21.length - 1];
  const spread = Math.abs(a - b) / b;
  if (spread < 0.0005) return "flat";
  if (a > b && price > a) return "up";
  if (a < b && price < a) return "down";
  return "flat";
}

// Fractal swing: candle high > N neighbors on each side = swing high; symmetric for lows.
export function findSwingLevels(
  candles: Candle[],
  lookback = 2,
): { support: number | null; resistance: number | null } {
  if (candles.length < lookback * 2 + 1) return { support: null, resistance: null };
  const price = candles[candles.length - 1].c;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(c.h);
    if (isLow) lows.push(c.l);
  }
  // Nearest support = highest low below price. Nearest resistance = lowest high above price.
  const support = lows.filter((l) => l < price).sort((a, b) => b - a)[0] ?? null;
  const resistance = highs.filter((h) => h > price).sort((a, b) => a - b)[0] ?? null;
  return { support, resistance };
}

// Nearest round-number magnets (50 / 100 / 500 zones).
export function findRoundLevels(price: number): {
  nearest: number;
  above: number;
  below: number;
  distancePct: number;
} {
  // Pick the finest grid that still yields a level within ~1% of price.
  const grids = [50, 100, 500];
  let best = { nearest: 0, above: 0, below: 0, distancePct: Infinity };
  for (const g of grids) {
    const below = Math.floor(price / g) * g;
    const above = below + g;
    const nearest = price - below < above - price ? below : above;
    const distancePct = Math.abs(price - nearest) / price;
    if (distancePct < best.distancePct) best = { nearest, above, below, distancePct };
  }
  return best;
}

// Long-wick rejection on the last 1–3 candles near a level.
// Wick side = above body → upper rejection (bearish); wick below body → lower rejection (bullish).
export function rejectionWick(
  lastCandles: Candle[],
  level: number | null,
): { present: boolean; direction: "bullish" | "bearish" | null } {
  if (!level || lastCandles.length === 0) return { present: false, direction: null };
  const take = lastCandles.slice(-3);
  for (const c of take) {
    const body = Math.abs(c.c - c.o);
    if (body <= 0) continue;
    const upperWick = c.h - Math.max(c.c, c.o);
    const lowerWick = Math.min(c.c, c.o) - c.l;
    // Rejection from above (bearish) — high touched/crossed level, big upper wick.
    if (c.h >= level && upperWick >= 2 * body && c.c < level) {
      return { present: true, direction: "bearish" };
    }
    // Rejection from below (bullish) — low touched/crossed level, big lower wick.
    if (c.l <= level && lowerWick >= 2 * body && c.c > level) {
      return { present: true, direction: "bullish" };
    }
  }
  return { present: false, direction: null };
}
