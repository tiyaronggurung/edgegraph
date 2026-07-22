// Real TA engine — live-wired, not shadow.
// Pulls EMA/RSI/MACD/VWAP/ATR/Bollinger + candle patterns off 1m + 5m
// candles that are already fetched upstream. Pure functions, no I/O.
//
// Output: a single -100..+100 directional score used as a hard skip gate
// in cryptoAutoTrade. Positive = YES/up bias, negative = NO/down bias.

import type { Candle } from "./chartSignals";

export const TA_ENGINE_VERSION = "ta-v1";

// ── Indicators ────────────────────────────────────────────────────────────
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(0, d)) / period;
    avgL = (avgL * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal) return null;
  const eF = emaSeries(values, fast);
  const eS = emaSeries(values, slow);
  const macdLine = eF.map((v, i) => v - eS[i]);
  const sig = emaSeries(macdLine.slice(slow - 1), signal);
  const hist: number[] = [];
  for (let i = 0; i < sig.length; i++) hist.push(macdLine[slow - 1 + i] - sig[i]);
  return {
    macd: macdLine[macdLine.length - 1],
    signal: sig[sig.length - 1],
    hist: hist[hist.length - 1],
    prevHist: hist.length >= 2 ? hist[hist.length - 2] : 0,
  };
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const first = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let a = first;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

export function bollinger(values: number[], period = 20, mult = 2) {
  if (values.length < period) return null;
  const win = values.slice(-period);
  const mean = win.reduce((a, b) => a + b, 0) / period;
  const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + mult * sd, lower = mean - mult * sd;
  const price = values[values.length - 1];
  const pctB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;
  return { upper, lower, mean, sd, pctB };
}

// Session VWAP over the given candles (already scoped to session by caller).
export function sessionVwap(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  let pv = 0, vv = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * (c.v || 1);
    vv += c.v || 1;
  }
  return vv > 0 ? pv / vv : null;
}

// ── Candle patterns ──────────────────────────────────────────────────────
export function bullEngulfing(cs: Candle[]): boolean {
  if (cs.length < 2) return false;
  const a = cs[cs.length - 2], b = cs[cs.length - 1];
  return a.c < a.o && b.c > b.o && b.c >= a.o && b.o <= a.c;
}
export function bearEngulfing(cs: Candle[]): boolean {
  if (cs.length < 2) return false;
  const a = cs[cs.length - 2], b = cs[cs.length - 1];
  return a.c > a.o && b.c < b.o && b.o >= a.c && b.c <= a.o;
}

// Higher-high + higher-low over last N closed candles → uptrend structure.
export function structure(cs: Candle[], n = 5): "up" | "down" | "flat" {
  if (cs.length < n + 1) return "flat";
  const tail = cs.slice(-n - 1);
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = 1; i < tail.length; i++) {
    if (tail[i].h > tail[i - 1].h) hh++; else lh++;
    if (tail[i].l > tail[i - 1].l) hl++; else ll++;
  }
  if (hh >= n - 1 && hl >= n - 2) return "up";
  if (lh >= n - 1 && ll >= n - 2) return "down";
  return "flat";
}

// ── TA verdict score −100..+100 ──────────────────────────────────────────
export interface TaScoreResult {
  score: number;                       // −100..+100
  reasons: string[];
  vwapDistPct: number | null;          // (price - vwap)/vwap * 100
  trendAlignScore: number;             // −100..+100 (EMA stack alignment)
  rsi1m: number | null;
  rsi5m: number | null;
  macd5mHist: number | null;
  bb5mPctB: number | null;
  atr1m: number | null;
  vwapRejectedAgainstUp: boolean;      // last candle rejected off VWAP downward
  vwapRejectedAgainstDown: boolean;    // last candle rejected off VWAP upward
}

function emaStackScore(closes: Candle[]): { score: number; reason: string } {
  if (closes.length < 170) return { score: 0, reason: "ema-stack:insufficient" };
  const vals = closes.map(c => c.c);
  const e9 = emaSeries(vals, 9).at(-1)!;
  const e21 = emaSeries(vals, 21).at(-1)!;
  const e55 = emaSeries(vals, 55).at(-1)!;
  const e145 = emaSeries(vals, 145).at(-1)!;
  const e169 = emaSeries(vals, 169).at(-1)!;
  const price = vals[vals.length - 1];
  const up = price > e9 && e9 > e21 && e21 > e55 && e55 > e145 && e145 > e169;
  const down = price < e9 && e9 < e21 && e21 < e55 && e55 < e145 && e145 < e169;
  if (up) return { score: 100, reason: "ema-stack:full-up" };
  if (down) return { score: -100, reason: "ema-stack:full-down" };
  // Partial: count monotonic pairs
  const ups = [price > e9, e9 > e21, e21 > e55, e55 > e145, e145 > e169].filter(Boolean).length;
  const downs = [price < e9, e9 < e21, e21 < e55, e55 < e145, e145 < e169].filter(Boolean).length;
  const raw = (ups - downs) / 5 * 100;
  return { score: raw, reason: `ema-stack:partial(${ups}up/${downs}dn)` };
}

export function computeTaScore(candles1m: Candle[], candles5m: Candle[]): TaScoreResult {
  const reasons: string[] = [];
  const closes1 = candles1m.map(c => c.c);
  const closes5 = candles5m.map(c => c.c);
  const price = closes1.at(-1) ?? closes5.at(-1) ?? null;

  // Weighted vote to a signed score.
  let score = 0;

  // 1) EMA stack on 1m (heaviest weight — the multi-EMA screenshot the user showed)
  const stack = emaStackScore(candles1m);
  score += stack.score * 0.30;
  reasons.push(stack.reason);

  // 2) 5m structure: higher-highs/lows
  const s5 = structure(candles5m, 5);
  if (s5 === "up") { score += 20; reasons.push("5m-struct:up"); }
  else if (s5 === "down") { score -= 20; reasons.push("5m-struct:down"); }

  // 3) 1m structure
  const s1 = structure(candles1m, 5);
  if (s1 === "up") { score += 10; reasons.push("1m-struct:up"); }
  else if (s1 === "down") { score -= 10; reasons.push("1m-struct:down"); }

  // 4) MACD 5m histogram sign + flip
  const m5 = macd(closes5);
  let macd5mHist: number | null = null;
  if (m5) {
    macd5mHist = m5.hist;
    if (m5.hist > 0 && m5.hist >= m5.prevHist) { score += 12; reasons.push("macd5m:bull-rising"); }
    else if (m5.hist > 0) { score += 6; reasons.push("macd5m:bull"); }
    else if (m5.hist < 0 && m5.hist <= m5.prevHist) { score -= 12; reasons.push("macd5m:bear-falling"); }
    else if (m5.hist < 0) { score -= 6; reasons.push("macd5m:bear"); }
  }

  // 5) RSI: 1m + 5m — extreme overbought/oversold gives directional pushback
  const r1 = rsi(closes1, 14);
  const r5 = rsi(closes5, 14);
  if (r5 !== null) {
    if (r5 >= 70) { score -= 8; reasons.push(`rsi5m:${r5.toFixed(0)}-ob`); }
    else if (r5 <= 30) { score += 8; reasons.push(`rsi5m:${r5.toFixed(0)}-os`); }
    else if (r5 > 55) { score += 4; reasons.push(`rsi5m:${r5.toFixed(0)}-bull`); }
    else if (r5 < 45) { score -= 4; reasons.push(`rsi5m:${r5.toFixed(0)}-bear`); }
  }

  // 6) Bollinger 5m position (pctB): riding upper band = trending up
  const bb5 = bollinger(closes5, 20, 2);
  const bb5mPctB = bb5?.pctB ?? null;
  if (bb5) {
    if (bb5.pctB >= 0.95) { score += 6; reasons.push("bb5m:upper-ride"); }
    else if (bb5.pctB <= 0.05) { score -= 6; reasons.push("bb5m:lower-ride"); }
  }

  // 7) VWAP side + rejection
  const vwap = sessionVwap(candles1m);
  let vwapDistPct: number | null = null;
  let vwapRejectedAgainstUp = false;
  let vwapRejectedAgainstDown = false;
  if (vwap !== null && price !== null) {
    vwapDistPct = ((price - vwap) / vwap) * 100;
    if (price > vwap) { score += 10; reasons.push(`vwap:above(+${vwapDistPct.toFixed(2)}%)`); }
    else if (price < vwap) { score -= 10; reasons.push(`vwap:below(${vwapDistPct.toFixed(2)}%)`); }

    // Last 2 candles: did we tag VWAP from one side and close back to the other? = rejection.
    const tail = candles1m.slice(-2);
    for (const c of tail) {
      const body = Math.abs(c.c - c.o);
      if (body <= 0) continue;
      // Wick pierced above vwap but closed below → bearish rejection = bad for UP bets
      if (c.h > vwap && c.c < vwap && (c.h - Math.max(c.c, c.o)) > body) {
        vwapRejectedAgainstUp = true;
        score -= 15; reasons.push("vwap:rejected-up");
      }
      if (c.l < vwap && c.c > vwap && (Math.min(c.c, c.o) - c.l) > body) {
        vwapRejectedAgainstDown = true;
        score += 15; reasons.push("vwap:rejected-down");
      }
    }
  }

  // 8) Engulfing on 1m
  if (bullEngulfing(candles1m)) { score += 8; reasons.push("1m:bull-engulf"); }
  if (bearEngulfing(candles1m)) { score -= 8; reasons.push("1m:bear-engulf"); }

  score = Math.max(-100, Math.min(100, Math.round(score)));

  return {
    score,
    reasons,
    vwapDistPct,
    trendAlignScore: Math.round(stack.score),
    rsi1m: r1,
    rsi5m: r5,
    macd5mHist,
    bb5mPctB,
    atr1m: atr(candles1m, 14),
    vwapRejectedAgainstUp,
    vwapRejectedAgainstDown,
  };
}
