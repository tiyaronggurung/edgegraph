import { useMemo } from "react";
import { useBinanceBtcTicks, type BtcTick } from "./useBinanceBtcTicks";

// Detects "big" 1-minute candles and forecasts whether the currently forming
// candle is on track to close as a big green (hold longs) or big red (sell).
//
// Definition of "big": |body| >= BIG_SIGMA_MULT × σ(last 30 completed bodies).
// Forecast: extrapolate the forming candle's body to close using the last
// FORECAST_TICK_WINDOW_MS of tick velocity + buy/sell imbalance, then compare
// against the same σ threshold.

const BIG_SIGMA_MULT = 2;
const HISTORY_BARS = 30;             // 30 min of completed bodies for σ
const FORECAST_TICK_WINDOW_MS = 15_000;
const MIN_BARS_FOR_STATS = 8;
const RECENT_DETECT_MS = 5 * 60_000; // keep detected big candles for 5 min

export interface Candle1m {
  t: number;   // bar open time (ms, floored to minute)
  o: number;
  h: number;
  l: number;
  c: number;
  body: number;      // c - o (signed)
  absBody: number;
  buyVol: number;    // BTC bought at market
  sellVol: number;   // BTC sold at market
  imbalance: number; // (buy - sell) / (buy + sell), -1..1
  closed: boolean;
}

export interface BigCandleEvent {
  t: number;
  side: "green" | "red";
  body: number;
  sigma: number;
  sigmaMult: number;
}

export type CandleForecast = "big_green" | "big_red" | "small_green" | "small_red" | "flat";

export interface CandleMomentum {
  ready: boolean;
  connected: boolean;
  candles: Candle1m[];
  formingCandle: Candle1m | null;
  sigmaBody: number;               // σ of last 30 completed |body|
  bigThreshold: number;            // body magnitude that counts as "big"
  forecast: CandleForecast;
  forecastBody: number;            // projected body at close
  forecastConfidence: number;      // 0..100
  forecastReason: string;
  recentBig: BigCandleEvent[];     // last 5 min of confirmed big candles
  /** Auto-trade guidance: "sell" = big red forming, "hold" = big green forming, "neutral" = neither */
  guidance: "sell" | "hold" | "neutral";
}

function buildCandles(ticks: BtcTick[]): Candle1m[] {
  if (ticks.length === 0) return [];
  const map = new Map<number, Candle1m>();
  for (const tk of ticks) {
    const bar = Math.floor(tk.t / 60_000) * 60_000;
    let c = map.get(bar);
    if (!c) {
      c = { t: bar, o: tk.p, h: tk.p, l: tk.p, c: tk.p, body: 0, absBody: 0, buyVol: 0, sellVol: 0, imbalance: 0, closed: false };
      map.set(bar, c);
    }
    if (tk.p > c.h) c.h = tk.p;
    if (tk.p < c.l) c.l = tk.p;
    c.c = tk.p;
    // isBuyerMaker=true => aggressor is a SELLER (market sell)
    if (tk.m) c.sellVol += tk.q;
    else c.buyVol += tk.q;
  }
  const out = Array.from(map.values()).sort((a, b) => a.t - b.t);
  const nowBar = Math.floor(Date.now() / 60_000) * 60_000;
  for (const c of out) {
    c.body = c.c - c.o;
    c.absBody = Math.abs(c.body);
    const tot = c.buyVol + c.sellVol;
    c.imbalance = tot > 0 ? (c.buyVol - c.sellVol) / tot : 0;
    c.closed = c.t < nowBar;
  }
  return out;
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / (vals.length - 1);
  return Math.sqrt(v);
}

export function useCandleMomentum(): CandleMomentum {
  const { ticks, connected } = useBinanceBtcTicks();

  return useMemo(() => {
    const candles = buildCandles(ticks);
    const closed = candles.filter(c => c.closed);
    const forming = candles.find(c => !c.closed) ?? null;

    const bodies = closed.slice(-HISTORY_BARS).map(c => c.absBody).filter(v => v > 0);
    const sigmaBody = stddev(bodies);
    const bigThreshold = sigmaBody * BIG_SIGMA_MULT;

    const ready = closed.length >= MIN_BARS_FOR_STATS && sigmaBody > 0;

    // Detected big candles in last 5 min
    const cutoff = Date.now() - RECENT_DETECT_MS;
    const recentBig: BigCandleEvent[] = closed
      .filter(c => c.t >= cutoff && ready && c.absBody >= bigThreshold)
      .map(c => ({
        t: c.t,
        side: c.body >= 0 ? "green" : "red",
        body: c.body,
        sigma: sigmaBody,
        sigmaMult: sigmaBody > 0 ? c.absBody / sigmaBody : 0,
      }));

    // Forecast forming candle
    let forecast: CandleForecast = "flat";
    let forecastBody = 0;
    let forecastConfidence = 0;
    let forecastReason = "warming up";
    let guidance: "sell" | "hold" | "neutral" = "neutral";

    if (ready && forming) {
      const now = Date.now();
      const elapsedMs = now - forming.t;
      const remainingMs = Math.max(1_000, 60_000 - elapsedMs);
      // Recent tick velocity ($/sec) over the last window
      const winStart = now - FORECAST_TICK_WINDOW_MS;
      const recent = ticks.filter(t => t.t >= winStart);
      let velocity = 0;
      let buyQ = 0, sellQ = 0;
      if (recent.length >= 2) {
        const first = recent[0], last = recent[recent.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt > 0) velocity = (last.p - first.p) / dt; // $/sec
        for (const r of recent) { if (r.m) sellQ += r.q; else buyQ += r.q; }
      }
      const imb = (buyQ + sellQ) > 0 ? (buyQ - sellQ) / (buyQ + sellQ) : 0;
      // Project remaining move: dampen velocity by 60% (mean reversion) and
      // nudge by tick imbalance.
      const projectedRemaining = velocity * (remainingMs / 1000) * 0.4 + imb * sigmaBody * 0.3;
      forecastBody = forming.body + projectedRemaining;

      const mag = Math.abs(forecastBody);
      const sameSignAsRecent = Math.sign(forecastBody) === Math.sign(velocity) || velocity === 0;
      // Confidence: how far above/below threshold + agreement of velocity+imbalance
      const ratio = sigmaBody > 0 ? mag / sigmaBody : 0;
      const agree = Math.sign(velocity) === Math.sign(imb) && velocity !== 0 ? 1 : 0.5;
      forecastConfidence = Math.min(100, Math.round((ratio / BIG_SIGMA_MULT) * 60 + agree * 25 + (sameSignAsRecent ? 15 : 0)));

      if (mag >= bigThreshold) {
        if (forecastBody > 0) {
          forecast = "big_green";
          guidance = "hold";
          forecastReason = `projected +$${forecastBody.toFixed(0)} body ≥ ${BIG_SIGMA_MULT}σ ($${bigThreshold.toFixed(0)})`;
        } else {
          forecast = "big_red";
          guidance = "sell";
          forecastReason = `projected -$${Math.abs(forecastBody).toFixed(0)} body ≥ ${BIG_SIGMA_MULT}σ ($${bigThreshold.toFixed(0)})`;
        }
      } else if (mag < sigmaBody * 0.4) {
        forecast = "flat";
        forecastReason = `projected body $${forecastBody.toFixed(0)} < 0.4σ — indecisive`;
      } else {
        forecast = forecastBody >= 0 ? "small_green" : "small_red";
        forecastReason = `projected body $${forecastBody.toFixed(0)} — normal candle`;
      }
    }

    return {
      ready,
      connected,
      candles,
      formingCandle: forming,
      sigmaBody,
      bigThreshold,
      forecast,
      forecastBody,
      forecastConfidence,
      forecastReason,
      recentBig,
      guidance,
    };
  }, [ticks, connected]);
}
