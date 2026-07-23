// Pure trendline + spike detector. No I/O, no Date.now(), deterministic.
// Fits linear regression through recent swing highs (upper) and swing lows
// (lower), detects channel/wedge geometry, and flags "spike" candles that
// break the channel with an abnormally large body.
//
// Consumed by:
//   - src/lib/trendlineShadow.functions.ts (server fn: logs to shadow table)
//   - src/components/crypto/TrendlineChartPanel.tsx (visual overlay)

export interface TCandle {
  t: number; o: number; h: number; l: number; c: number;
}

export interface Line {
  slope: number;      // price units per millisecond
  intercept: number;  // price at t=0
  points: { t: number; price: number }[]; // swings used
}

export interface TrendlineResult {
  upper: Line | null;
  lower: Line | null;
  upperAtNow: number | null;
  lowerAtNow: number | null;
  channelWidthPct: number | null;
  distToUpperPct: number | null;   // (upper - close) / close * 100
  distToLowerPct: number | null;   // (close - lower) / close * 100
  isWedge: boolean;                // lines converging
  wedgeBias: "bull" | "bear" | "sym" | null;
  swingsUsed: number;
}

export interface SpikeResult {
  detected: boolean;
  direction: "up" | "down" | null;
  bodyRatio: number;      // |body| / avg20 body
  breakPct: number;       // % beyond channel (positive number)
}

const PIVOT_N = 2; // 5-bar fractal
const MIN_SWINGS = 3;
const MAX_LOOKBACK = 90; // last ~90 1m candles ≈ 90 min

interface Swing { t: number; price: number; kind: "H" | "L" }

function findSwings(candles: TCandle[]): Swing[] {
  const out: Swing[] = [];
  for (let i = PIVOT_N; i < candles.length - PIVOT_N; i++) {
    const c = candles[i];
    let isH = true, isL = true;
    for (let j = 1; j <= PIVOT_N; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isH = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) out.push({ t: c.t, price: c.h, kind: "H" });
    if (isL) out.push({ t: c.t, price: c.l, kind: "L" });
  }
  return out;
}

// Ordinary least-squares fit through swing points.
function fitLine(points: { t: number; price: number }[]): Line | null {
  const n = points.length;
  if (n < 2) return null;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanP = points.reduce((s, p) => s + p.price, 0) / n;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.price - meanP);
    den += (p.t - meanT) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanP - slope * meanT;
  return { slope, intercept, points };
}

function priceOnLine(line: Line, t: number): number {
  return line.slope * t + line.intercept;
}

export function detectTrendlines(candles: TCandle[]): TrendlineResult {
  const empty: TrendlineResult = {
    upper: null, lower: null,
    upperAtNow: null, lowerAtNow: null,
    channelWidthPct: null, distToUpperPct: null, distToLowerPct: null,
    isWedge: false, wedgeBias: null, swingsUsed: 0,
  };
  if (candles.length < PIVOT_N * 2 + 3) return empty;

  const window = candles.slice(-MAX_LOOKBACK);
  const swings = findSwings(window);
  const highs = swings.filter(s => s.kind === "H").slice(-5);
  const lows = swings.filter(s => s.kind === "L").slice(-5);

  const upper = highs.length >= MIN_SWINGS ? fitLine(highs) : null;
  const lower = lows.length >= MIN_SWINGS ? fitLine(lows) : null;

  const last = window[window.length - 1];
  const upperNow = upper ? priceOnLine(upper, last.t) : null;
  const lowerNow = lower ? priceOnLine(lower, last.t) : null;
  const close = last.c;

  const channelWidthPct = upperNow != null && lowerNow != null && close > 0
    ? ((upperNow - lowerNow) / close) * 100 : null;
  const distToUpperPct = upperNow != null && close > 0
    ? ((upperNow - close) / close) * 100 : null;
  const distToLowerPct = lowerNow != null && close > 0
    ? ((close - lowerNow) / close) * 100 : null;

  // Wedge = upper slope < 0 AND lower slope > 0 (converging).
  let isWedge = false;
  let wedgeBias: "bull" | "bear" | "sym" | null = null;
  if (upper && lower) {
    const upDown = upper.slope < 0;
    const loUp = lower.slope > 0;
    isWedge = upDown && loUp;
    if (isWedge) {
      const absUp = Math.abs(upper.slope);
      const absLo = Math.abs(lower.slope);
      // Steeper upper (falling faster) → bullish wedge; steeper lower → bearish.
      if (absUp > absLo * 1.3) wedgeBias = "bull";
      else if (absLo > absUp * 1.3) wedgeBias = "bear";
      else wedgeBias = "sym";
    }
  }

  return {
    upper, lower, upperAtNow: upperNow, lowerAtNow: lowerNow,
    channelWidthPct, distToUpperPct, distToLowerPct,
    isWedge, wedgeBias,
    swingsUsed: highs.length + lows.length,
  };
}

// Rule (c): both channel break ≥ 0.1% AND body ≥ 2× avg20 body.
export function detectSpike(
  candles: TCandle[],
  trend: TrendlineResult,
  breakPctThreshold = 0.1,
  bodyMult = 2.0,
): SpikeResult {
  const empty: SpikeResult = { detected: false, direction: null, bodyRatio: 0, breakPct: 0 };
  if (candles.length < 21) return empty;
  const last = candles[candles.length - 1];
  const prev20 = candles.slice(-21, -1);
  const avgBody = prev20.reduce((s, c) => s + Math.abs(c.c - c.o), 0) / prev20.length;
  const body = Math.abs(last.c - last.o);
  const bodyRatio = avgBody > 0 ? body / avgBody : 0;

  if (bodyRatio < bodyMult) return { ...empty, bodyRatio };

  const close = last.c;
  let breakPct = 0;
  let direction: "up" | "down" | null = null;
  if (trend.upperAtNow != null && close > trend.upperAtNow) {
    breakPct = ((close - trend.upperAtNow) / trend.upperAtNow) * 100;
    direction = "up";
  } else if (trend.lowerAtNow != null && close < trend.lowerAtNow) {
    breakPct = ((trend.lowerAtNow - close) / trend.lowerAtNow) * 100;
    direction = "down";
  }
  if (!direction || breakPct < breakPctThreshold) {
    return { detected: false, direction, bodyRatio, breakPct };
  }
  return { detected: true, direction, bodyRatio, breakPct };
}
