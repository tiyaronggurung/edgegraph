import { useMemo } from "react";
import { useBinanceBtcTicks, type BtcTick } from "./useBinanceBtcTicks";
import { useBinanceBtcFutures } from "./useBinanceBtcFutures";
import { useBinanceLiquidations } from "./useBinanceLiquidations";
import { useBinanceEthSpotVelocity } from "./useBinanceEthSpotVelocity";
import { useBtcVelocity } from "./useBtcVelocity";

// "Chart-reading" verdict computed from live Binance aggTrade ticks + futures
// mark/funding/OI + forced-liquidation clusters + ETH correlation.
//
// Score is 0..100 where 50 = neutral. > 50 = bullish bias, < 50 = bearish.
// Components (weighted):
//   • VWAP bias         (20%)  price vs 15-min VWAP
//   • Momentum RSI(14)  (15%)  on 1m closes
//   • Order-flow ratio  (15%)  buy vol / (buy+sell) last 3m (spot takers)
//   • Micro-trend       (15%)  count of green vs red in last 5 × 1m candles
//   • Rejection wick    (10%)  last 1m candle wick vs body direction
//   • Futures bias      (15%)  basis (perp-spot) + funding + OI delta
//   • Liquidations      (10%)  60s cluster: long-cap = bounce, short-squeeze = up
//
// Also computes:
//   • 5m EMA20/EMA50 stack (for HTF trend gate — surfaced separately, not scored)
//   • ETH agreement (correlation guard — downgrades to chop when BTC/ETH diverge)
//   • Nearest support/resistance from swing pivots in last 30 min

export interface ChartVerdict {
  ready: boolean;
  connected: boolean;
  samples: number;
  score: number;             // 0..100
  bias: "up" | "down" | "flat";
  strength: "strong" | "moderate" | "weak" | "chop";
  vwap: number | null;
  vwapDeltaUsd: number | null;
  vwapDeltaPct: number | null;
  rsi: number | null;
  buyRatio: number | null;   // 0..1
  greenCount: number;        // out of last 5 candles
  lastCandle: { o: number; h: number; l: number; c: number } | null;
  wickBias: "up" | "down" | "neutral";
  support: number | null;
  resistance: number | null;
  reason: string;

  // Futures snapshot
  futuresConnected: boolean;
  markPrice: number | null;
  basisUsd: number | null;         // perp - spot
  fundingBiasPct: number | null;   // funding rate * 100
  oiDelta5mPct: number | null;
  futuresBias: "up" | "down" | "flat";
  futuresReason: string;

  // Liquidations
  liqConnected: boolean;
  liqBias: "long-cap" | "short-squeeze" | "neutral";
  liqStrength: "strong" | "moderate" | "neutral";
  liqReason: string;
  longsLiq60sUsd: number;
  shortsLiq60sUsd: number;

  // HTF (5m EMA stack)
  htfReady: boolean;
  htfTrend: "up" | "down" | "flat";
  ema20_5m: number | null;
  ema50_5m: number | null;
  htfReason: string;

  // ETH agreement
  ethConnected: boolean;
  ethAgrees: boolean | null;   // null when insufficient data
  ethReason: string;
}

interface Candle { o: number; h: number; l: number; c: number; v: number; buyV: number; t0: number; t1: number }

function buildCandles(ticks: BtcTick[], intervalMs: number, maxCandles: number): Candle[] {
  if (!ticks.length) return [];
  const now = ticks[ticks.length - 1].t;
  const start = now - intervalMs * maxCandles;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const t of ticks) {
    if (t.t < start) continue;
    const bucketStart = Math.floor(t.t / intervalMs) * intervalMs;
    if (!cur || cur.t0 !== bucketStart) {
      if (cur) out.push(cur);
      cur = { o: t.p, h: t.p, l: t.p, c: t.p, v: 0, buyV: 0, t0: bucketStart, t1: bucketStart + intervalMs };
    }
    cur.h = Math.max(cur.h, t.p);
    cur.l = Math.min(cur.l, t.p);
    cur.c = t.p;
    cur.v += t.q;
    if (!t.m) cur.buyV += t.q;
  }
  if (cur) out.push(cur);
  return out;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (gains + losses === 0) return 50;
  const rs = (gains / period) / Math.max(1e-9, losses / period);
  return 100 - 100 / (1 + rs);
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function findSupportResistance(candles: Candle[], price: number): { support: number | null; resistance: number | null } {
  if (candles.length < 5) return { support: null, resistance: null };
  const pivotsHi: number[] = [];
  const pivotsLo: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    if (h >= candles[i-1].h && h >= candles[i-2].h && h >= candles[i+1].h && h >= candles[i+2].h) pivotsHi.push(h);
    if (l <= candles[i-1].l && l <= candles[i-2].l && l <= candles[i+1].l && l <= candles[i+2].l) pivotsLo.push(l);
  }
  const support = pivotsLo.filter(x => x < price).sort((a,b) => b - a)[0] ?? null;
  const resistance = pivotsHi.filter(x => x > price).sort((a,b) => a - b)[0] ?? null;
  return { support, resistance };
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

// Weight tables per regime. Rows must sum to 1.0.
// "mixed" is identical to the pre-regime static weights.
const WEIGHTS = {
  mixed: { vwap: 0.20, rsi: 0.15, flow: 0.15, trend: 0.15, wick: 0.10, futures: 0.15, liq: 0.10 },
  trend: { vwap: 0.25, rsi: 0.05, flow: 0.15, trend: 0.20, wick: 0.05, futures: 0.20, liq: 0.10 },
  chop:  { vwap: 0.15, rsi: 0.20, flow: 0.10, trend: 0.05, wick: 0.20, futures: 0.10, liq: 0.20 },
} as const;
export type VerdictRegime = keyof typeof WEIGHTS;

export interface VerdictOptions {
  regime?: VerdictRegime;
  coinbase?: { price: number | null; connected: boolean };  // Phase 3 lead-lag
}

export function useChartVerdict(regimeOrOpts: VerdictRegime | VerdictOptions = "mixed"): ChartVerdict {
  const opts: VerdictOptions = typeof regimeOrOpts === "string" ? { regime: regimeOrOpts } : regimeOrOpts;
  const regime: VerdictRegime = opts.regime ?? "mixed";
  const coinbase = opts.coinbase;
  const { ticks, connected, count } = useBinanceBtcTicks();
  const fut = useBinanceBtcFutures();
  const liq = useBinanceLiquidations();
  const eth = useBinanceEthSpotVelocity();
  const btcVel = useBtcVelocity();

  return useMemo<ChartVerdict>(() => {
    const emptyBase = {
      // Futures pass-through even when spot is warming up
      futuresConnected: fut.connected,
      markPrice: fut.markPrice,
      basisUsd: null as number | null,
      fundingBiasPct: fut.fundingBiasPct,
      oiDelta5mPct: fut.oiDelta5mPct,
      futuresBias: "flat" as "up" | "down" | "flat",
      futuresReason: "warming up",
      liqConnected: liq.connected,
      liqBias: liq.bias,
      liqStrength: liq.strength,
      liqReason: liq.reason,
      longsLiq60sUsd: liq.longsLiq60sUsd,
      shortsLiq60sUsd: liq.shortsLiq60sUsd,
      htfReady: false,
      htfTrend: "flat" as "up" | "down" | "flat",
      ema20_5m: null as number | null,
      ema50_5m: null as number | null,
      htfReason: "insufficient 5m history",
      ethConnected: eth.connected,
      ethAgrees: null as boolean | null,
      ethReason: "warming up",
    };
    const empty: ChartVerdict = {
      ready: false, connected, samples: count,
      score: 50, bias: "flat", strength: "chop",
      vwap: null, vwapDeltaUsd: null, vwapDeltaPct: null,
      rsi: null, buyRatio: null, greenCount: 0,
      lastCandle: null, wickBias: "neutral",
      support: null, resistance: null,
      reason: connected ? "warming up — collecting ticks…" : "chart feed offline",
      ...emptyBase,
    };
    if (!ticks.length) return empty;

    const now = ticks[ticks.length - 1].t;
    const price = ticks[ticks.length - 1].p;

    // 15-min VWAP
    const vwapCutoff = now - 15 * 60_000;
    let pv = 0, vv = 0;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i];
      if (t.t < vwapCutoff) break;
      pv += t.p * t.q;
      vv += t.q;
    }
    const vwap = vv > 0 ? pv / vv : null;
    const vwapDeltaUsd = vwap != null ? price - vwap : null;
    const vwapDeltaPct = vwap != null ? ((price - vwap) / vwap) * 100 : null;

    // 1m candles for RSI + micro-trend + wick + S/R
    const candles1m = buildCandles(ticks, 60_000, 30);
    const closes1m = candles1m.map(c => c.c);
    const rsiVal = rsi(closes1m, 14);

    const last5 = candles1m.slice(-5);
    const greenCount = last5.filter(c => c.c >= c.o).length;

    // 5m candles for HTF EMA stack
    const candles5m = buildCandles(ticks, 5 * 60_000, 30);
    const closes5m = candles5m.map(c => c.c);
    const ema20_5m = ema(closes5m, 20);
    const ema50_5m = ema(closes5m, 50);
    const htfReady = ema20_5m != null && ema50_5m != null;
    let htfTrend: "up" | "down" | "flat" = "flat";
    let htfReason = "insufficient 5m history";
    if (htfReady && ema20_5m != null && ema50_5m != null) {
      if (price > ema20_5m && ema20_5m > ema50_5m) { htfTrend = "up"; htfReason = `above 5m EMA20 $${ema20_5m.toFixed(0)} > EMA50 $${ema50_5m.toFixed(0)}`; }
      else if (price < ema20_5m && ema20_5m < ema50_5m) { htfTrend = "down"; htfReason = `below 5m EMA20 $${ema20_5m.toFixed(0)} < EMA50 $${ema50_5m.toFixed(0)}`; }
      else { htfTrend = "flat"; htfReason = `5m EMAs tangled — no HTF trend`; }
    }

    // Buy/sell pressure last 3m
    const bpCutoff = now - 3 * 60_000;
    let buyV = 0, sellV = 0;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i];
      if (t.t < bpCutoff) break;
      if (t.m) sellV += t.q; else buyV += t.q;
    }
    const buyRatio = (buyV + sellV) > 0 ? buyV / (buyV + sellV) : null;

    // Wick bias
    const last = candles1m[candles1m.length - 1] ?? null;
    let wickBias: "up" | "down" | "neutral" = "neutral";
    if (last) {
      const body = Math.abs(last.c - last.o);
      const upperWick = last.h - Math.max(last.o, last.c);
      const lowerWick = Math.min(last.o, last.c) - last.l;
      if (lowerWick > body * 1.5 && lowerWick > upperWick) wickBias = "up";
      else if (upperWick > body * 1.5 && upperWick > lowerWick) wickBias = "down";
    }

    const { support, resistance } = findSupportResistance(candles1m, price);

    // ----- Futures score component ------------------------------------
    // Combines basis (perp vs spot), funding (bull-crowded/bear-crowded), OI delta.
    const basisUsd = fut.markPrice != null ? fut.markPrice - price : null;
    let s_futures = 50;
    const futParts: string[] = [];
    if (basisUsd != null) {
      // ±$5 basis → ±10 skew
      s_futures += clamp(basisUsd * 2, -10, 10);
      futParts.push(`basis ${basisUsd >= 0 ? "+" : ""}$${basisUsd.toFixed(1)}`);
    }
    if (fut.fundingBiasPct != null) {
      // Positive funding = longs paying → crowded long → mildly bearish contrarian
      // But strong positive funding usually accompanies uptrends → net small effect.
      // Use as fade: >0.02%/8h = crowded long → -5, <-0.02% = crowded short → +5
      const f = fut.fundingBiasPct;
      s_futures += clamp(-f * 250, -8, 8);
      futParts.push(`fund ${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}bp`);
    }
    if (fut.oiDelta5mPct != null) {
      // OI rising + price rising = new longs (bullish); OI rising + price falling = new shorts.
      const pxChange = btcVel.pctChange3min ?? 0;
      const oi = fut.oiDelta5mPct;
      // Same-sign = strong direction; opposite = position unwind (fade)
      const sameSign = Math.sign(oi) === Math.sign(pxChange) && Math.abs(pxChange) > 0.05;
      if (sameSign) {
        s_futures += clamp(pxChange * 20, -8, 8);
      }
      futParts.push(`OI Δ5m ${oi >= 0 ? "+" : ""}${oi.toFixed(2)}%`);
    }
    s_futures = clamp(s_futures, 0, 100);
    const futuresBias: "up" | "down" | "flat" =
      Math.abs(s_futures - 50) < 5 ? "flat" : s_futures > 50 ? "up" : "down";
    const futuresReason = fut.markPrice != null
      ? futParts.join(" · ") || "futures neutral"
      : "futures feed warming up";

    // ----- Liquidation score component --------------------------------
    // long-cap (longs liquidated) = capitulation → bounce (bullish reversal)
    // short-squeeze = shorts stopped out → continuation up (bullish)
    // Both point up when strong; but long-cap in downtrend is a fade signal.
    let s_liq = 50;
    if (liq.bias !== "neutral") {
      const boost = liq.strength === "strong" ? 20 : liq.strength === "moderate" ? 10 : 0;
      if (liq.bias === "long-cap") s_liq += boost;         // bounce → bullish reversal
      else if (liq.bias === "short-squeeze") s_liq += boost; // continuation up
    }
    s_liq = clamp(s_liq, 0, 100);

    // Score components (each maps to 0..100 signed around 50).
    const s_vwap = vwapDeltaPct != null ? clamp(50 + vwapDeltaPct * 500, 0, 100) : 50;
    const s_rsi = rsiVal != null ? clamp(rsiVal, 0, 100) : 50;
    let s_flow = buyRatio != null ? clamp(50 + (buyRatio - 0.5) * 200, 0, 100) : 50;
    // Phase 3 — Coinbase lead-lag: >2 bps divergence nudges flow ±3 pts.
    if (coinbase?.connected && coinbase.price != null && Number.isFinite(coinbase.price)) {
      const diffBps = ((coinbase.price - price) / price) * 10_000;
      if (Math.abs(diffBps) > 2) s_flow = clamp(s_flow + Math.max(-3, Math.min(3, diffBps * 0.5)), 0, 100);
    }
    const s_trend = clamp(20 + greenCount * 15, 0, 100);
    const s_wick = wickBias === "up" ? 75 : wickBias === "down" ? 25 : 50;

    const readyEnough = ticks.length > 50 && candles1m.length >= 5;
    if (!readyEnough) return { ...empty, ...emptyBase, connected, samples: count, vwap, vwapDeltaUsd, vwapDeltaPct, basisUsd, futuresBias, futuresReason, reason: `warming up — ${count} ticks, ${candles1m.length}/5 candles` };

    const W = WEIGHTS[regime];
    let score = clamp(
      s_vwap    * W.vwap +
      s_rsi     * W.rsi +
      s_flow    * W.flow +
      s_trend   * W.trend +
      s_wick    * W.wick +
      s_futures * W.futures +
      s_liq     * W.liq,
      0, 100,
    );

    // ---- Guards (mean-reversion + streak) --------------------------------
    const guardNotes: string[] = [];

    // 1) S/R belt proximity
    const belt = price * 0.0015;
    if (score > 50 && resistance != null && (resistance - price) <= belt && resistance > price) {
      score -= 15;
      guardNotes.push(`resist belt $${resistance.toFixed(0)} — cap likely`);
    }
    if (score < 50 && support != null && (price - support) <= belt && support < price) {
      score += 15;
      guardNotes.push(`support belt $${support.toFixed(0)} — bounce likely`);
    }

    // 2) Streak guard
    if (candles1m.length >= 2) {
      const c1 = candles1m[candles1m.length - 1];
      const c2 = candles1m[candles1m.length - 2];
      const twoGreen = c1.c >= c1.o && c2.c >= c2.o;
      const twoRed   = c1.c <  c1.o && c2.c <  c2.o;
      const bullConfirmed = (vwapDeltaPct ?? 0) > 0.10 && (rsiVal ?? 0) > 60 && (buyRatio ?? 0) > 0.60;
      const bearConfirmed = (vwapDeltaPct ?? 0) < -0.10 && (rsiVal ?? 100) < 40 && (buyRatio ?? 1) < 0.40;
      if (twoGreen && score > 50 && !bullConfirmed) { score -= 20; guardNotes.push("2 grn — no bull-run confirm"); }
      if (twoRed && score < 50 && !bearConfirmed)   { score += 20; guardNotes.push("2 red — no bear-run confirm"); }
    }
    score = clamp(score, 0, 100);

    // ---- ETH agreement guard ------------------------------------------
    // If BTC and ETH move opposite ways (both >0.1% in 1min), downgrade score toward 50.
    let ethAgrees: boolean | null = null;
    let ethReason = "insufficient ETH history";
    const btc1 = btcVel.pctChange1min;
    const eth1 = eth.pctChange1min;
    if (btc1 != null && eth1 != null) {
      const btcMove = Math.abs(btc1) > 0.10;
      const ethMove = Math.abs(eth1) > 0.10;
      if (btcMove && ethMove) {
        ethAgrees = Math.sign(btc1) === Math.sign(eth1);
        ethReason = ethAgrees
          ? `BTC ${btc1.toFixed(2)}% / ETH ${eth1.toFixed(2)}% — aligned`
          : `BTC ${btc1.toFixed(2)}% / ETH ${eth1.toFixed(2)}% — DIVERGING`;
        if (!ethAgrees) {
          // Pull toward chop
          const pull = (score - 50) * 0.5;
          score -= pull;
          guardNotes.push("ETH diverges — softened");
        }
      } else {
        ethReason = `BTC ${btc1.toFixed(2)}% / ETH ${eth1.toFixed(2)}% — too quiet`;
      }
    }
    score = clamp(score, 0, 100);

    const skew = score - 50;
    const bias: "up" | "down" | "flat" = Math.abs(skew) < 5 ? "flat" : skew > 0 ? "up" : "down";
    const strength: "strong" | "moderate" | "weak" | "chop" =
      Math.abs(skew) >= 20 ? "strong" :
      Math.abs(skew) >= 12 ? "moderate" :
      Math.abs(skew) >= 5  ? "weak" : "chop";

    const parts: string[] = [];
    if (vwapDeltaUsd != null) parts.push(`VWAP ${vwapDeltaUsd >= 0 ? "+" : ""}$${vwapDeltaUsd.toFixed(0)}`);
    if (rsiVal != null) parts.push(`RSI ${rsiVal.toFixed(0)}`);
    if (buyRatio != null) parts.push(`buy ${(buyRatio*100).toFixed(0)}%`);
    parts.push(`${greenCount}/5 grn`);
    if (wickBias !== "neutral") parts.push(`${wickBias === "up" ? "▼wick" : "▲wick"}`);
    if (support && resistance) parts.push(`S $${support.toFixed(0)} / R $${resistance.toFixed(0)}`);
    if (basisUsd != null) parts.push(`fut ${basisUsd >= 0 ? "+" : ""}$${basisUsd.toFixed(0)}`);
    if (liq.bias !== "neutral" && liq.strength !== "neutral") parts.push(`liq ${liq.bias}`);
    if (guardNotes.length) parts.push(...guardNotes);

    return {
      ready: true, connected, samples: count,
      score, bias, strength,
      vwap, vwapDeltaUsd, vwapDeltaPct,
      rsi: rsiVal, buyRatio, greenCount,
      lastCandle: last ? { o: last.o, h: last.h, l: last.l, c: last.c } : null,
      wickBias, support, resistance,
      reason: parts.join(" · "),

      futuresConnected: fut.connected,
      markPrice: fut.markPrice,
      basisUsd,
      fundingBiasPct: fut.fundingBiasPct,
      oiDelta5mPct: fut.oiDelta5mPct,
      futuresBias, futuresReason,

      liqConnected: liq.connected,
      liqBias: liq.bias, liqStrength: liq.strength, liqReason: liq.reason,
      longsLiq60sUsd: liq.longsLiq60sUsd, shortsLiq60sUsd: liq.shortsLiq60sUsd,

      htfReady, htfTrend, ema20_5m, ema50_5m, htfReason,

      ethConnected: eth.connected, ethAgrees, ethReason,
    };

  }, [ticks, connected, count, fut, liq, eth, btcVel, regime, coinbase?.price, coinbase?.connected]);
}
