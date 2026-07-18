// Pure TA indicators. No I/O. Shadow-only telemetry math.
// All functions accept closed candles oldest → newest. Latest = last element.

export interface Candle {
  t: number; // open time ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Simple moving average of the last `period` closes. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

/** Exponential moving average series, same length as input. */
export function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder RSI(14) on closes. Returns null if not enough data. */
export function rsi(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c;
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  line: number;
  signal: number;
  hist: number;
  cross: "bull" | "bear" | "none";
}

/** MACD(12,26,9) on closes. Cross detected on the last completed candle vs previous. */
export function macd(candles: Candle[], fast = 12, slow = 26, signalP = 9): MacdResult | null {
  if (candles.length < slow + signalP + 2) return null;
  const closes = candles.map((c) => c.c);
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine: number[] = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = emaSeries(macdLine, signalP);
  const n = closes.length - 1;
  const line = macdLine[n];
  const signal = signalLine[n];
  const hist = line - signal;
  const prevHist = macdLine[n - 1] - signalLine[n - 1];
  let cross: MacdResult["cross"] = "none";
  if (prevHist <= 0 && hist > 0) cross = "bull";
  else if (prevHist >= 0 && hist < 0) cross = "bear";
  return { line, signal, hist, cross };
}

export interface BbResult {
  upper: number;
  mid: number;
  lower: number;
  pctB: number;
  bandwidth: number;
  squeeze: boolean;
}

/** Bollinger Bands (20, 2σ). Squeeze if bandwidth is in the bottom 20% of the last 60 bars. */
export function bollinger(candles: Candle[], period = 20, mult = 2): BbResult | null {
  if (candles.length < period + 60) {
    if (candles.length < period) return null;
  }
  const closes = candles.map((c) => c.c);
  const mid = sma(closes, period);
  if (mid == null) return null;
  const slice = closes.slice(-period);
  const variance = slice.reduce((a, v) => a + (v - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  const price = closes[closes.length - 1];
  const pctB = (price - lower) / (upper - lower || 1);
  const bandwidth = (upper - lower) / (mid || 1);

  // Squeeze: bandwidth in the bottom 20% of the last 60 bandwidth samples.
  let squeeze = false;
  if (candles.length >= period + 60) {
    const bws: number[] = [];
    for (let i = candles.length - 60; i < candles.length; i++) {
      const sl = closes.slice(i - period + 1, i + 1);
      const m = sl.reduce((a, v) => a + v, 0) / period;
      const va = sl.reduce((a, v) => a + (v - m) ** 2, 0) / period;
      const sd = Math.sqrt(va);
      bws.push((2 * mult * sd) / (m || 1));
    }
    const sorted = [...bws].sort((a, b) => a - b);
    const p20 = sorted[Math.floor(sorted.length * 0.2)];
    squeeze = bandwidth <= p20;
  }
  return { upper, mid, lower, pctB, bandwidth, squeeze };
}

export interface AdxResult {
  adx: number;
  plusDi: number;
  minusDi: number;
}

/** Wilder ADX(14) with +DI / −DI. */
export function adx(candles: Candle[], period = 14): AdxResult | null {
  if (candles.length < period * 2 + 1) return null;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }
  // Wilder smoothing
  const wilder = (arr: number[]): number[] => {
    const out: number[] = [];
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    out[period - 1] = s;
    for (let i = period; i < arr.length; i++) {
      out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    }
    return out;
  };
  const trS = wilder(trs);
  const pDMS = wilder(plusDMs);
  const mDMS = wilder(minusDMs);
  const dxs: number[] = [];
  for (let i = period - 1; i < trs.length; i++) {
    const t = trS[i] || 1;
    const pdi = 100 * (pDMS[i] / t);
    const mdi = 100 * (mDMS[i] / t);
    const dx = (100 * Math.abs(pdi - mdi)) / (pdi + mdi || 1);
    dxs.push(dx);
  }
  if (dxs.length < period) return null;
  // ADX = Wilder average of DX
  let adxVal = 0;
  for (let i = 0; i < period; i++) adxVal += dxs[i];
  adxVal /= period;
  for (let i = period; i < dxs.length; i++) {
    adxVal = (adxVal * (period - 1) + dxs[i]) / period;
  }
  const lastIdx = trs.length - 1;
  const tLast = trS[lastIdx] || 1;
  return {
    adx: adxVal,
    plusDi: 100 * (pDMS[lastIdx] / tLast),
    minusDi: 100 * (mDMS[lastIdx] / tLast),
  };
}

/** True range series for ATR. */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    sum += Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
  }
  let val = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    val = (val * (period - 1) + tr) / period;
  }
  return val;
}

/** Session-anchored VWAP. Session start = UTC midnight of the last candle. */
export function sessionVwap(candles: Candle[]): number | null {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const dayStart = Math.floor(last.t / 86_400_000) * 86_400_000;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    if (c.t < dayStart) continue;
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    vol += c.v;
  }
  return vol > 0 ? pv / vol : null;
}

export interface VolumeProfileResult {
  poc: number;
  vah: number;
  val: number;
  position: "below_val" | "in_value" | "above_vah";
}

/**
 * Volume Profile over the last N candles.
 * Buckets = 50 price levels between min-low and max-high; POC = highest-volume bucket.
 * Value area = 70% of total volume expanding outward from POC.
 */
export function volumeProfile(
  candles: Candle[],
  price: number,
  buckets = 50,
): VolumeProfileResult | null {
  if (candles.length < 20) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / buckets;
  const vols = new Array(buckets).fill(0);
  for (const c of candles) {
    // Distribute candle volume uniformly across the bins it spans.
    const iLo = Math.max(0, Math.min(buckets - 1, Math.floor((c.l - lo) / step)));
    const iHi = Math.max(0, Math.min(buckets - 1, Math.floor((c.h - lo) / step)));
    const span = iHi - iLo + 1;
    const per = c.v / span;
    for (let i = iLo; i <= iHi; i++) vols[i] += per;
  }
  let pocIdx = 0;
  let pocVol = vols[0];
  let total = 0;
  for (let i = 0; i < buckets; i++) {
    total += vols[i];
    if (vols[i] > pocVol) {
      pocVol = vols[i];
      pocIdx = i;
    }
  }
  // Expand outward from POC until 70% of volume covered.
  const target = total * 0.7;
  let acc = vols[pocIdx];
  let lo2 = pocIdx;
  let hi2 = pocIdx;
  while (acc < target && (lo2 > 0 || hi2 < buckets - 1)) {
    const leftV = lo2 > 0 ? vols[lo2 - 1] : -1;
    const rightV = hi2 < buckets - 1 ? vols[hi2 + 1] : -1;
    if (rightV >= leftV) {
      hi2 += 1;
      acc += vols[hi2];
    } else {
      lo2 -= 1;
      acc += vols[lo2];
    }
  }
  const poc = lo + (pocIdx + 0.5) * step;
  const val = lo + lo2 * step;
  const vah = lo + (hi2 + 1) * step;
  const position: VolumeProfileResult["position"] =
    price < val ? "below_val" : price > vah ? "above_vah" : "in_value";
  return { poc, vah, val, position };
}

export type TrendDir = "up" | "down" | "flat";

/** EMA9 vs EMA21 trend. Flat when EMAs are within 0.05% of each other. */
export function emaTrend(candles: Candle[]): TrendDir {
  if (candles.length < 22) return "flat";
  const closes = candles.map((c) => c.c);
  const e9 = emaSeries(closes, 9);
  const e21 = emaSeries(closes, 21);
  const price = closes[closes.length - 1];
  const a = e9[e9.length - 1];
  const b = e21[e21.length - 1];
  const spread = Math.abs(a - b) / (b || 1);
  if (spread < 0.0005) return "flat";
  if (a > b && price > a) return "up";
  if (a < b && price < a) return "down";
  return "flat";
}
