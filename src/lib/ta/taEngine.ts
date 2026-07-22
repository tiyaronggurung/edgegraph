// Real TA engine v2 — confluence scorer, live-wired.
// Weighted 100-pt confluence across the seven indicator families a discretionary
// trader would watch on a 15m BTC market, plus rate-of-change ("acceleration")
// on the three that reveal fading momentum before the price flips.
//
// Output: signed −100..+100 (direction) + 0..100 confidence + a per-component
// breakdown in `reasons` so the UI/DB can show WHAT drove the number.

import type { Candle } from "./chartSignals";

export const TA_ENGINE_VERSION = "ta-v2";

// ── Component weights (sum = 100) ────────────────────────────────────────
// EMA structure is the heaviest — matches the user's multi-EMA screenshot.
const W_EMA = 25;
const W_VWAP = 20;
const W_STRUCT = 20;
const W_MACD = 15;
const W_RSI = 10;
const W_CANDLE = 5;
const W_BB = 5;
// Acceleration is a bonus (not part of the base 100) — up to ±15 pts to
// reward "widening" signals and penalize "fading" ones.
const W_ACCEL_MAX = 15;

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
    prev2Hist: hist.length >= 3 ? hist[hist.length - 3] : 0,
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
  const bandwidth = mean > 0 ? (upper - lower) / mean : 0;
  return { upper, lower, mean, sd, pctB, bandwidth };
}

// Session VWAP over the given candles. If timestamps are present, restart at
// midnight UTC so we get a real intraday VWAP rather than an all-history mean.
export function sessionVwap(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const lastDay = last.t ? Math.floor(last.t / 86400) : null;
  let pv = 0, vv = 0;
  for (const c of candles) {
    if (lastDay !== null && c.t && Math.floor(c.t / 86400) !== lastDay) continue;
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * (c.v || 1);
    vv += c.v || 1;
  }
  if (vv === 0) {
    // Fallback: use all candles if today's session had no volume yet.
    for (const c of candles) {
      const typical = (c.h + c.l + c.c) / 3;
      pv += typical * (c.v || 1);
      vv += c.v || 1;
    }
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
function strongClose(cs: Candle[]): number {
  // +1 = last candle closed in top 20% of its range, −1 = bottom 20%, 0 else.
  if (cs.length < 1) return 0;
  const c = cs[cs.length - 1];
  const range = c.h - c.l;
  if (range <= 0) return 0;
  const pos = (c.c - c.l) / range;
  if (pos >= 0.8) return 1;
  if (pos <= 0.2) return -1;
  return 0;
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
  score: number;                       // −100..+100 signed direction
  confidence: number;                  // 0..100 magnitude / how loud
  reasons: string[];                   // per-component breakdown, e.g. "ema:+22"
  breakdown: Record<string, number>;   // machine-readable per-component scores
  vwapDistPct: number | null;          // (price - vwap)/vwap * 100
  vwapDistDeltaPct: number | null;     // rate-of-change of vwap distance across last 5 candles
  trendAlignScore: number;             // −100..+100 (EMA stack alignment)
  emaGapPct: number | null;            // EMA9 − EMA21 as % of price (signed)
  emaGapWideningPct: number | null;    // Δ(EMA9−EMA21) over last 5 candles as % of price
  rsi1m: number | null;
  rsi5m: number | null;
  macd5mHist: number | null;
  macd5mHistDelta: number | null;      // hist - prevHist (acceleration)
  bb5mPctB: number | null;
  bb5mBandwidth: number | null;        // squeeze detector
  atr1m: number | null;
  vwapRejectedAgainstUp: boolean;      // last candle rejected off VWAP downward
  vwapRejectedAgainstDown: boolean;    // last candle rejected off VWAP upward
}

// ── Component scorers (each returns signed −W..+W) ────────────────────────
function scoreEmaStack(closes1m: Candle[]): {
  score: number;
  reason: string;
  trendAlignScore: number;
  emaGapPct: number | null;
  emaGapWideningPct: number | null;
} {
  const vals = closes1m.map(c => c.c);
  if (vals.length < 30) {
    return { score: 0, reason: `ema:0(need30,have${vals.length})`, trendAlignScore: 0, emaGapPct: null, emaGapWideningPct: null };
  }
  const need169 = vals.length >= 170;
  const need55 = vals.length >= 60;
  const e9 = emaSeries(vals, 9);
  const e21 = emaSeries(vals, 21);
  const e55 = need55 ? emaSeries(vals, 55) : null;
  const e145 = vals.length >= 150 ? emaSeries(vals, 145) : null;
  const e169 = need169 ? emaSeries(vals, 169) : null;
  const price = vals[vals.length - 1];
  const g9 = e9.at(-1)!;
  const g21 = e21.at(-1)!;
  const g55 = e55?.at(-1) ?? null;
  const g145 = e145?.at(-1) ?? null;
  const g169 = e169?.at(-1) ?? null;

  // Alignment: how many adjacent EMA pairs are in the correct order for UP.
  const upPairs = [
    price > g9,
    g9 > g21,
    ...(g55 != null ? [g21 > g55] : []),
    ...(g55 != null && g145 != null ? [g55 > g145] : []),
    ...(g145 != null && g169 != null ? [g145 > g169] : []),
  ];
  const downPairs = [
    price < g9,
    g9 < g21,
    ...(g55 != null ? [g21 < g55] : []),
    ...(g55 != null && g145 != null ? [g55 < g145] : []),
    ...(g145 != null && g169 != null ? [g145 < g169] : []),
  ];
  const totalPairs = upPairs.length;
  const upsAligned = upPairs.filter(Boolean).length;
  const downsAligned = downPairs.filter(Boolean).length;
  const align = (upsAligned - downsAligned) / totalPairs; // −1..+1
  const score = Math.round(align * W_EMA);

  const trendAlignScore = Math.round(align * 100);

  const emaGapPct = price > 0 ? ((g9 - g21) / price) * 100 : null;

  // Acceleration: is the 9/21 gap widening in the direction of the trend?
  const prevIdx = vals.length - 6;
  let emaGapWideningPct: number | null = null;
  if (prevIdx > 0) {
    const prevG9 = e9[prevIdx];
    const prevG21 = e21[prevIdx];
    const prevPrice = vals[prevIdx];
    const prevGap = prevPrice > 0 ? ((prevG9 - prevG21) / prevPrice) * 100 : 0;
    if (emaGapPct != null) emaGapWideningPct = emaGapPct - prevGap;
  }

  const reason = `ema:${score >= 0 ? "+" : ""}${score}(${upsAligned}/${totalPairs}up)`;
  return { score, reason, trendAlignScore, emaGapPct, emaGapWideningPct };
}

function scoreVwap(candles1m: Candle[]): {
  score: number;
  reason: string;
  vwapDistPct: number | null;
  vwapDistDeltaPct: number | null;
  vwapRejectedAgainstUp: boolean;
  vwapRejectedAgainstDown: boolean;
} {
  const vwap = sessionVwap(candles1m);
  const price = candles1m.at(-1)?.c ?? null;
  if (vwap == null || price == null) {
    return { score: 0, reason: "vwap:0(nodata)", vwapDistPct: null, vwapDistDeltaPct: null, vwapRejectedAgainstUp: false, vwapRejectedAgainstDown: false };
  }
  const distPct = ((price - vwap) / vwap) * 100;

  // Scale: 0.05% above → half weight, ≥0.15% → full weight. Symmetric.
  const mag = Math.min(1, Math.abs(distPct) / 0.15);
  let base = Math.sign(distPct) * mag * W_VWAP;

  // Rejection check on last 2 candles.
  let rejUp = false, rejDown = false;
  const tail = candles1m.slice(-2);
  for (const c of tail) {
    const body = Math.abs(c.c - c.o);
    if (body <= 0) continue;
    if (c.h > vwap && c.c < vwap && (c.h - Math.max(c.c, c.o)) > body) rejUp = true;
    if (c.l < vwap && c.c > vwap && (Math.min(c.c, c.o) - c.l) > body) rejDown = true;
  }
  if (rejUp) base -= W_VWAP * 0.75;
  if (rejDown) base += W_VWAP * 0.75;
  const score = Math.round(Math.max(-W_VWAP * 1.5, Math.min(W_VWAP * 1.5, base)));

  // Distance acceleration: is price pushing further from VWAP over last 5?
  let vwapDistDeltaPct: number | null = null;
  if (candles1m.length >= 6) {
    const prevPrice = candles1m[candles1m.length - 6].c;
    const prevDist = ((prevPrice - vwap) / vwap) * 100;
    vwapDistDeltaPct = distPct - prevDist;
  }

  const tag = rejUp ? "+rejUp" : rejDown ? "+rejDown" : "";
  const reason = `vwap:${score >= 0 ? "+" : ""}${score}(${distPct.toFixed(2)}%${tag})`;
  return { score, reason, vwapDistPct: distPct, vwapDistDeltaPct, vwapRejectedAgainstUp: rejUp, vwapRejectedAgainstDown: rejDown };
}

function scoreStructure(c1m: Candle[], c5m: Candle[]): { score: number; reason: string } {
  const s5 = structure(c5m, 5);
  const s1 = structure(c1m, 5);
  let s = 0;
  if (s5 === "up") s += W_STRUCT * 0.6;
  else if (s5 === "down") s -= W_STRUCT * 0.6;
  if (s1 === "up") s += W_STRUCT * 0.4;
  else if (s1 === "down") s -= W_STRUCT * 0.4;
  // Divergence penalty: 1m and 5m disagree = low-conviction environment.
  if ((s1 === "up" && s5 === "down") || (s1 === "down" && s5 === "up")) s *= 0.3;
  const score = Math.round(s);
  return { score, reason: `struct:${score >= 0 ? "+" : ""}${score}(1m=${s1}/5m=${s5})` };
}

function scoreMacd(closes5m: number[]): { score: number; reason: string; hist: number | null; delta: number | null } {
  const m = macd(closes5m);
  if (!m) return { score: 0, reason: `macd:0(need35,have${closes5m.length})`, hist: null, delta: null };
  const delta = m.hist - m.prevHist;
  let s = 0;
  if (m.hist > 0 && delta > 0) s = W_MACD;              // bull + accelerating
  else if (m.hist > 0 && delta <= 0) s = W_MACD * 0.4;   // bull but fading
  else if (m.hist < 0 && delta < 0) s = -W_MACD;         // bear + accelerating
  else if (m.hist < 0 && delta >= 0) s = -W_MACD * 0.4;  // bear but fading
  const score = Math.round(s);
  const tag = m.hist > 0
    ? (delta > 0 ? "bull↑" : "bull↓")
    : (delta < 0 ? "bear↓" : "bear↑");
  return { score, reason: `macd:${score >= 0 ? "+" : ""}${score}(${tag})`, hist: m.hist, delta };
}

function scoreRsi(closes5m: number[], closes1m: number[]): { score: number; reason: string; r5: number | null; r1: number | null } {
  const r5 = rsi(closes5m, 14);
  const r1 = rsi(closes1m, 14);
  let s = 0;
  const label: string[] = [];
  if (r5 != null) {
    // 55–70 = bull momentum, 30–45 = bear momentum. Extremes = pushback.
    if (r5 >= 70) { s -= W_RSI * 0.4; label.push(`5m=${r5.toFixed(0)}ob`); }
    else if (r5 >= 55) { s += W_RSI * 0.7; label.push(`5m=${r5.toFixed(0)}↑`); }
    else if (r5 <= 30) { s += W_RSI * 0.4; label.push(`5m=${r5.toFixed(0)}os`); }
    else if (r5 <= 45) { s -= W_RSI * 0.7; label.push(`5m=${r5.toFixed(0)}↓`); }
    else label.push(`5m=${r5.toFixed(0)}flat`);
  }
  if (r1 != null) {
    if (r1 >= 60) s += W_RSI * 0.3;
    else if (r1 <= 40) s -= W_RSI * 0.3;
  }
  s = Math.max(-W_RSI, Math.min(W_RSI, s));
  const score = Math.round(s);
  return { score, reason: `rsi:${score >= 0 ? "+" : ""}${score}(${label.join(",")})`, r5, r1 };
}

function scoreCandles(c1m: Candle[]): { score: number; reason: string } {
  let s = 0;
  const tags: string[] = [];
  if (bullEngulfing(c1m)) { s += W_CANDLE; tags.push("bull-engulf"); }
  if (bearEngulfing(c1m)) { s -= W_CANDLE; tags.push("bear-engulf"); }
  const sc = strongClose(c1m);
  if (sc !== 0) {
    s += sc * W_CANDLE * 0.5;
    tags.push(sc > 0 ? "strong-close↑" : "strong-close↓");
  }
  s = Math.max(-W_CANDLE, Math.min(W_CANDLE, s));
  const score = Math.round(s);
  return { score, reason: `candle:${score >= 0 ? "+" : ""}${score}${tags.length ? `(${tags.join("/")})` : ""}` };
}

function scoreBollinger(closes5m: number[]): { score: number; reason: string; pctB: number | null; bandwidth: number | null } {
  const bb = bollinger(closes5m, 20, 2);
  if (!bb) return { score: 0, reason: `bb:0(need20,have${closes5m.length})`, pctB: null, bandwidth: null };
  let s = 0;
  const tags: string[] = [];
  // Riding upper (%B ≥ 0.9) = trending up; riding lower (≤ 0.1) = trending down.
  if (bb.pctB >= 0.9) { s += W_BB; tags.push("upper-ride"); }
  else if (bb.pctB <= 0.1) { s -= W_BB; tags.push("lower-ride"); }
  // Squeeze = low conviction — zero out contribution.
  if (bb.bandwidth < 0.003) { s *= 0.2; tags.push("squeeze"); }
  const score = Math.round(s);
  return { score, reason: `bb:${score >= 0 ? "+" : ""}${score}(%B=${bb.pctB.toFixed(2)}${tags.length ? `,${tags.join(",")}` : ""})`, pctB: bb.pctB, bandwidth: bb.bandwidth };
}

// ── Master scorer ────────────────────────────────────────────────────────
export function computeTaScore(candles1m: Candle[], candles5m: Candle[]): TaScoreResult {
  const closes1m = candles1m.map(c => c.c);
  const closes5m = candles5m.map(c => c.c);

  const ema = scoreEmaStack(candles1m);
  const vwap = scoreVwap(candles1m);
  const struc = scoreStructure(candles1m, candles5m);
  const mac = scoreMacd(closes5m);
  const rs = scoreRsi(closes5m, closes1m);
  const cand = scoreCandles(candles1m);
  const bb = scoreBollinger(closes5m);

  // Base confluence sum.
  let score = ema.score + vwap.score + struc.score + mac.score + rs.score + cand.score + bb.score;

  // ── Acceleration bonus (±W_ACCEL_MAX) ─────────────────────────────────
  // Reward when momentum indicators are actively widening in the score's
  // direction; penalize when they're fading. This captures "moves reverse
  // when momentum slows, not when indicators flip" (user's spec).
  let accel = 0;
  const dirSign = score >= 0 ? 1 : -1;
  // EMA9-21 gap widening in trend direction
  if (ema.emaGapWideningPct != null && ema.emaGapPct != null) {
    const widening = Math.sign(ema.emaGapPct) === Math.sign(ema.emaGapWideningPct)
      && Math.sign(ema.emaGapPct) === dirSign;
    if (widening) accel += W_ACCEL_MAX * 0.5 * dirSign;
    else if (Math.sign(ema.emaGapWideningPct) === -dirSign) accel += W_ACCEL_MAX * 0.25 * -dirSign;
  }
  // MACD histogram accelerating in trend direction
  if (mac.delta != null && mac.hist != null) {
    if (Math.sign(mac.delta) === dirSign && Math.sign(mac.hist) === dirSign) {
      accel += W_ACCEL_MAX * 0.35 * dirSign;
    } else if (Math.sign(mac.delta) === -dirSign) {
      accel += W_ACCEL_MAX * 0.2 * -dirSign;
    }
  }
  // VWAP distance opening up in trend direction
  if (vwap.vwapDistDeltaPct != null) {
    if (Math.sign(vwap.vwapDistDeltaPct) === dirSign) accel += W_ACCEL_MAX * 0.15 * dirSign;
    else accel += W_ACCEL_MAX * 0.1 * -dirSign;
  }
  accel = Math.max(-W_ACCEL_MAX, Math.min(W_ACCEL_MAX, accel));
  const accelInt = Math.round(accel);
  score += accelInt;

  score = Math.max(-100, Math.min(100, Math.round(score)));

  // Confidence = magnitude of the raw signed score (before the ±100 clamp).
  const confidence = Math.min(100, Math.abs(score));

  const breakdown: Record<string, number> = {
    ema: ema.score,
    vwap: vwap.score,
    struct: struc.score,
    macd: mac.score,
    rsi: rs.score,
    candle: cand.score,
    bb: bb.score,
    accel: accelInt,
  };

  const reasons = [
    `total:${score >= 0 ? "+" : ""}${score}(conf=${confidence})`,
    ema.reason, vwap.reason, struc.reason, mac.reason, rs.reason, cand.reason, bb.reason,
    `accel:${accelInt >= 0 ? "+" : ""}${accelInt}`,
    ...(ema.emaGapWideningPct != null ? [`emaGapΔ=${ema.emaGapWideningPct.toFixed(3)}%`] : []),
    ...(mac.delta != null ? [`macdΔ=${mac.delta.toFixed(2)}`] : []),
    ...(vwap.vwapDistDeltaPct != null ? [`vwapΔ=${vwap.vwapDistDeltaPct.toFixed(3)}%`] : []),
    `n1m=${closes1m.length}/n5m=${closes5m.length}`,
  ];

  return {
    score,
    confidence,
    reasons,
    breakdown,
    vwapDistPct: vwap.vwapDistPct,
    vwapDistDeltaPct: vwap.vwapDistDeltaPct,
    trendAlignScore: ema.trendAlignScore,
    emaGapPct: ema.emaGapPct,
    emaGapWideningPct: ema.emaGapWideningPct,
    rsi1m: rs.r1,
    rsi5m: rs.r5,
    macd5mHist: mac.hist,
    macd5mHistDelta: mac.delta,
    bb5mPctB: bb.pctB,
    bb5mBandwidth: bb.bandwidth,
    atr1m: atr(candles1m, 14),
    vwapRejectedAgainstUp: vwap.vwapRejectedAgainstUp,
    vwapRejectedAgainstDown: vwap.vwapRejectedAgainstDown,
  };
}
