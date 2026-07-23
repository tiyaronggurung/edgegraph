// Kalshi BTC 15-min up/down markets + model prediction.
// Model = lognormal diffusion CONDITIONED on intra-window realized price action.
// Optional override: POST market context to CRYPTO_MODEL_URL and use returned {prob}.
import { createServerFn } from "@tanstack/react-start";
import { computeGapAnalysis, computeRequiredEdgePts, evaluateGate } from "./cryptoBtcGate";
import { evaluateBtcEntry, type BtcEntryGateDecision } from "./btcEntryGate";
import { getBtcGateConfig } from "./btcGateConfig.server";
import { logBtcGateDecision } from "./btcGateLog.server";
import { getChartVerdict } from "./ta/chartVerdict";
import { detectTrendlines, detectSpike } from "./ta/trendlines";
import { computeTaScore, TA_ENGINE_VERSION, type TaScoreResult } from "./ta/taEngine";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const COINBASE = "https://api.exchange.coinbase.com";

export interface BtcCandle {
  t: number; o: number; h: number; l: number; c: number; v: number;
}

export interface BtcMicro {
  fundingRate: number;       // 8h funding rate (fraction, e.g. 0.0001 = +1bp / 8h)
  fundingAnnualBps: number;  // annualized basis-points
  oiNotional: number;        // perp open interest USD
  oiDelta5mPct: number;      // % change in OI over last ~5 min
  basisBps: number;          // (perp - spot) / spot * 10000
  cvdRatio: number;          // (buyVol - sellVol) / totalVol over last ~60s (-1..1)
  cvdBuyUsd: number;         // taker buy USD notional in window
  cvdSellUsd: number;        // taker sell USD notional in window
  ofi: number;               // (bidSize - askSize) / (bidSize + askSize) top 10 levels (-1..1)
  bookSpreadBps: number;     // best ask vs best bid in bps
  // Step 6 — large/whale aggressive flows (≥ $250k single fills). Proxy for
  // liquidation cascades; real liquidation feed is WS-only so we use this.
  whaleBuyUsd1m: number;
  whaleSellUsd1m: number;
  whaleImbalance1m: number;  // (-1..1)
  whaleBuyUsd5m: number;
  whaleSellUsd5m: number;
  whaleImbalance5m: number;  // (-1..1)
  whaleCount5m: number;
}

export interface BtcOptions {
  expiryMs: number;          // nearest Deribit expiry timestamp
  yearsToExpiry: number;
  underlying: number;        // Deribit's BTC index price
  atmIv: number;             // ATM implied vol (annualized fraction, e.g. 0.55)
  skew25: number;            // (iv_25dPut - iv_25dCall) / iv_atm  (>0 = downside fear)
  ivPut25: number;
  ivCall25: number;
  sampleCount: number;       // # of option contracts used
}


export interface BtcMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  subTitle: string;
  yesSubTitle: string;
  strike: number;
  yesPrice: number;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  openInterest: number;
  volume: number;
  volume24h: number;
  openTime: string | null;
  closeTime: string | null;
  spot: number;
  windowOpenPrice: number;   // BTC price at strike-window open
  realizedMoveBps: number;   // (spot - open)/open * 10000
  modelYesProb: number;
  modelBaseProb: number;     // diffusion-only prob (before micro adjustment)
  modelSource: "external" | "intra-window-diffusion";
  microAdjPts: number;       // points added by microstructure features
  optionsImpliedProb: number | null; // Deribit Black-Scholes prob (null if unavailable)
  optionsBlendPts: number;   // pts contributed by options blend
  calibAdjPts: number;       // pts from self-learning Platt calibration
  calibBucket: string;
  calibActive: boolean;
  edgePts: number;
  side: "YES" | "NO";
  edgeAbs: number;
  kellyFraction: number;     // quarter-Kelly bankroll fraction (display only)
  secondsToClose: number;
  // ── PHASE 1 · STEP 9 — Time/vol safety margin ─────────────────────────────
  // How many σ of remaining-window move it would take for spot to cross strike.
  // >2σ ≈ 97% safe on the locked side; <0.5σ ≈ coin flip. Drives exit signals.
  sigmaDistance: number;
  sigmaMinEffective: number; // realized + IV blended per-minute σ used by the model
  // Pricing study: pure random-walk fair value (diffusion + options blend, BEFORE
  // microstructure/calibration). Compare vs market YES ¢ to see Kalshi mispricing.
  theoryYesProb: number;
  // Phase 1 · probability decomposition. These stay untouched by market blend
  // and calibration so we can measure independent model skill vs. market copy.
  physicsProb: number;      // diffusion + drift only, no options/micro/calib/blend
  independentProb: number;  // physics + options + micro, no market blend, no calib

  // ── PHASE 1 · STEP 5 — Edge gate ─────────────────────────────────────────
  requiredEdgePts: number;   // dynamic threshold edge must clear to BET
  gateAction: "BET" | "PASS";
  gateReason: string;        // human explanation of pass/bet
  thresholdParts: { base: number; calib: number; time: number; spread: number; regime: number; whale: number };
  // Chosen-side confidence: side==="YES" ? modelYesProb : 1-modelYesProb.
  // Historical: >=0.90 hits ~94%, <0.45 hits ~9% on 1,330 settled BTC rows.
  sideConf: number;
  // ── Gap analysis: why strike & spot differ, and whether spot can traverse the gap
  gapAnalysis: {
    gapUsd: number;            // signed $: positive = spot ABOVE strike, negative = BELOW
    gapPct: number;            // gapUsd / spot * 100
    needsToMoveUsd: number;    // signed $ spot must move for locked side to WIN at close (0 if already winning)
    needsDirection: "up" | "down" | "hold";
    expectedMoveUsd: number;   // σ_eff·√(t/60)·spot/100 … i.e. 1σ remaining-window move in $
    gapInSigmas: number;       // |needsToMoveUsd| / expectedMoveUsd (0 if already winning)
    momentumSign: -1 | 0 | 1;  // sign of cvdRatio+ofi blend
    momentumAlignsWithSide: boolean; // true = momentum helps locked side win
    verdict: string;           // one-liner: "spot $83 below strike; NO needs −$83 in 128s (0.29σ); momentum +0.4 fights NO"
  };
  // Anchor-drift z-score: how many sigmas BTC has moved from window open.
  // Positive = spot above open, negative = below. Telemetry for accuracy
  // analysis by drift magnitude; NOT blended into modelYesProb (probAboveCond
  // already accounts for anchor drift analytically).
  anchorZ: number;
  // ── Two-phase side model ───────────────────────────────────────────────────
  // `side` above is the LOCKED first-snapshot pick (never changes; used for
  // model-accuracy tracking). `liveSide` is the current best directional call
  // for THIS tick — may flip mid-window when chart verdict + anchor drift +
  // model all agree on the opposite direction. Auto-trader probe uses liveSide.
  liveSide: "YES" | "NO";
  liveFlipped: boolean;         // true if liveSide != locked side this tick
  chartVerdict: "YES" | "NO" | "neutral";
  chartStrength: number;        // 0..1 confidence from combined 1m+5m verdict
  // Real TA score −100..+100 (EMA9/21/55/145/169 stack + VWAP + RSI + MACD + BB + patterns).
  // Positive = up bias, negative = down bias. Used as a hard skip gate in auto-trade.
  taScore: number;
  taReasons: string[];
  taVwapDistPct: number | null;
  taTrendAlignScore: number;
  taRsi1m: number | null;
  taRsi5m: number | null;
  taMacd5mHist: number | null;
  taBb5mPctB: number | null;
  taVwapRejUp: boolean;   // last-2 candles rejected off VWAP downward → bad for UP bets
  taVwapRejDown: boolean; // last-2 candles rejected off VWAP upward → bad for DOWN bets
  // Shared central-gate decision (side confidence + live agreement + positive edge).
  // Reported alongside the legacy `gateAction`/`gateReason` so callers can
  // enforce the same universal gate. Nullable if config lookup failed.
  entryGate: BtcEntryGateDecision | null;
  // ── Strike Study warm-up (first 150s of every 15m window) ────────────────
  // During warm-up the model OBSERVES only — no bet fires, UI shows STUDYING.
  // After warm-up a strike verdict is emitted from the full signal stack.
  studying: boolean;                       // true = first 150s of window
  studyingSecondsLeft: number;             // seconds remaining in warm-up (0 once done)
  strikeVerdict: "SOLID" | "WEAK" | "CHOPPY" | null; // null while studying
  strikeVerdictReason: string;             // human-readable justification
  studyFindings: string[];                 // per-signal notes from the strike-study engine
}


export interface BtcCalibSummary {
  totalSettled: number;
  globalHitRate: number;
  globalBrier: number;
  buckets: Array<{ bucket: string; n: number; hitRate: number; meanProb: number; brier: number; a: number; b: number; active: boolean }>;
  global: { a: number; b: number; n: number; active: boolean };
}

interface BtcMarketsResult {
  spot: number;
  asOf: string;
  candles: BtcCandle[];
  markets: BtcMarket[];
  modelSource: "external" | "intra-window-diffusion";
  micro: BtcMicro | null;
  options: BtcOptions | null;
  calibration: BtcCalibSummary | null;
  regime: {
    regime: string;
    sigmaMult: number;
    driftBiasPerMin: number;
    confidence: number;
    reason: string;
    source: string;
    asOf: string;
  } | null;
}


const _kalshiCache = new Map<string, { at: number; data: any }>();
const KALSHI_TTL_MS = 8_000;
const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// INVARIANT: odds/market reads are PUBLIC and SHARED across all users.
// No Authorization header, no per-user Kalshi key — the response is identical
// for everyone and cached globally (KALSHI_TTL_MS). Per-user API keys apply
// only to signed trading calls (submit/sell/settle) in cryptoTrades.functions.ts.
// Do NOT thread userId into this path or every user would see different odds.
async function kalshiFetch(path: string): Promise<any> {
  const cached = _kalshiCache.get(path);
  if (cached && Date.now() - cached.at < KALSHI_TTL_MS) return cached.data;

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${KALSHI}${path}`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      _kalshiCache.set(path, { at: Date.now(), data });
      return data;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Kalshi ${res.status}`);
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      await _sleep(retryAfter > 0 ? retryAfter * 1000 : 400 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Kalshi ${res.status}`);
  }
  // Serve stale on persistent 429 rather than crashing the page.
  if (cached) return cached.data;
  throw lastErr ?? new Error("Kalshi failed");
}

async function fetchBtcCandles(): Promise<BtcCandle[]> {
  // Coinbase returns up to 300 candles per call. At granularity=60 that's 5h
  // of 1m data — enough for EMA169 (170 bars), MACD (35 bars), and RSI/BB.
  const res = await fetch(`${COINBASE}/products/BTC-USD/candles?granularity=60`, {
    headers: { Accept: "application/json", "User-Agent": "edgegraph/1.0" },
  });
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);
  const rows = (await res.json()) as number[][];
  return rows.map(([t, l, h, o, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

async function fetchBtcCandles5m(): Promise<BtcCandle[]> {
  // True 5m candles from Coinbase (granularity=300 = 25h of history).
  // We need ≥35 bars for MACD 5m, ≥20 for BB — this gives 300, plenty for both.
  const res = await fetch(`${COINBASE}/products/BTC-USD/candles?granularity=300`, {
    headers: { Accept: "application/json", "User-Agent": "edgegraph/1.0" },
  });
  if (!res.ok) throw new Error(`Coinbase 5m ${res.status}`);
  const rows = (await res.json()) as number[][];
  return rows.map(([t, l, h, o, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

// BRTI-style consolidated spot: median of Coinbase, Binance, Kraken mids.
// Closes the basis gap with Kalshi's settlement index.
export interface VenueSpotTick {
  source: "coinbase" | "binance" | "kraken";
  spot: number;
  sourceTimestampMs: number | null; // exchange-reported time; null when venue doesn't provide one
}
async function fetchConsolidatedSpotDetailed(fallback: number): Promise<{ median: number; ticks: VenueSpotTick[] }> {
  const sources = await Promise.allSettled<VenueSpotTick>([
    (async () => {
      const j: any = await fetch(
        "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
        { headers: { "User-Agent": "edgegraph/1.0" } },
      ).then(r => r.json());
      const t = j?.time ? Date.parse(j.time) : NaN;
      return { source: "coinbase", spot: Number(j.price), sourceTimestampMs: Number.isFinite(t) ? t : null };
    })(),
    (async () => {
      const j: any = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT").then(r => r.json());
      const t = Number(j?.closeTime);
      return { source: "binance", spot: Number(j.lastPrice ?? j.price), sourceTimestampMs: Number.isFinite(t) && t > 0 ? t : null };
    })(),
    (async () => {
      const j: any = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD").then(r => r.json());
      const k = Object.values(j.result ?? {})[0] as any;
      return { source: "kraken", spot: Number(k?.c?.[0]), sourceTimestampMs: null };
    })(),
  ]);
  const ticks: VenueSpotTick[] = sources
    .map(s => s.status === "fulfilled" ? s.value : null)
    .filter((t): t is VenueSpotTick => !!t && Number.isFinite(t.spot) && t.spot > 0);
  const vals = ticks.map(t => t.spot).sort((a, b) => a - b);
  if (!vals.length) return { median: fallback, ticks: [] };
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return { median, ticks };
}

// Backward-compat wrapper: existing call sites just want the number.
async function fetchConsolidatedSpot(fallback: number): Promise<number> {
  return (await fetchConsolidatedSpotDetailed(fallback)).median;
}

// Best-effort per-source last-seen exchange timestamp (in ms) to flag
// out-of-order arrivals. Lives in Worker isolate memory; survives inside
// one invocation and often across warm reuses — not a durable ordering
// guarantee, but useful for data-quality reporting.
const lastVenueTsMs = new Map<string, number>();

// Fire-and-forget: append per-venue ticks + the consolidated median to
// btc_spot_ticks so the jump-feature builder has a rolling window without
// adding an HTTP round-trip to the scoring hot path. Retention: pg_cron.
function recordSpotTick(median: number, ticks: VenueSpotTick[]): void {
  if (!(median > 0) || !Number.isFinite(median)) return;
  const receivedMs = Date.now();
  const receivedIso = new Date(receivedMs).toISOString();
  const receivedSec = Math.floor(receivedMs / 1000);
  const rows: Array<Record<string, unknown>> = [];

  for (const t of ticks) {
    if (!(t.spot > 0)) continue;
    const srcTsIso = t.sourceTimestampMs ? new Date(t.sourceTimestampMs).toISOString() : null;
    const latencyMs = t.sourceTimestampMs ? Math.max(0, receivedMs - t.sourceTimestampMs) : null;
    // Out-of-order iff we have a source ts AND it's older than the last one we saw for this venue.
    let outOfOrder = false;
    if (t.sourceTimestampMs) {
      const prev = lastVenueTsMs.get(t.source);
      if (prev != null && t.sourceTimestampMs < prev) outOfOrder = true;
      else lastVenueTsMs.set(t.source, t.sourceTimestampMs);
    }
    rows.push({
      observed_at: srcTsIso ?? receivedIso,
      observed_at_sec: t.sourceTimestampMs ? Math.floor(t.sourceTimestampMs / 1000) : receivedSec,
      source_timestamp: srcTsIso,
      received_at: receivedIso,
      latency_ms: latencyMs,
      spot: t.spot,
      source: t.source,
      out_of_order: outOfOrder,
    });
  }

  // Also persist the consolidated median for backward compatibility with
  // existing readers that key off source='consolidated'.
  rows.push({
    observed_at: receivedIso,
    observed_at_sec: receivedSec,
    source_timestamp: null,
    received_at: receivedIso,
    latency_ms: null,
    spot: median,
    source: "consolidated",
    out_of_order: false,
  });

  void (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("btc_spot_ticks")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(rows as any, { onConflict: "source,observed_at_sec", ignoreDuplicates: true });
    } catch {
      // Swallow — this is shadow data collection; must never impact scoring.
    }
  })();
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

// Student-t CDF (regularized incomplete beta via Lentz continued fraction).
// df=4 gives markedly fatter tails than Normal — BTC 1-min returns are
// leptokurtic, so extreme moves happen far more often than Gaussian implies.
// This is the #1 reason the old model collapsed to 0% / 99.9% and got blown out.
function studentTCdf(x: number, df: number): number {
  const lgamma = (z: number): number => {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let a = c[0];
    const t = z + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
  };
  const betacf = (a: number, b: number, xv: number): number => {
    const MAXIT = 200, EPS = 3e-7, FPMIN = 1e-30;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * xv / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * xv / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * xv / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  };
  const incBeta = (a: number, b: number, xv: number): number => {
    if (xv <= 0) return 0; if (xv >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(xv) + b * Math.log(1 - xv));
    if (xv < (a + 1) / (a + b + 2)) return bt * betacf(a, b, xv) / a;
    return 1 - bt * betacf(b, a, 1 - xv) / b;
  };
  const xx = df / (df + x * x);
  const half = 0.5 * incBeta(df / 2, 0.5, xx);
  return x >= 0 ? 1 - half : half;
}

function minuteSigmaPair(candles: BtcCandle[]): { shortSigma: number; longSigma: number } {
  if (candles.length < 5) return { shortSigma: 0.0008, longSigma: 0.0008 };
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const r = Math.log(candles[i].c / candles[i - 1].c);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (!rets.length) return { shortSigma: 0.0008, longSigma: 0.0008 };
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1);
  const longSigma = Math.max(1e-6, Math.sqrt(v));
  const tail = rets.slice(-5);
  if (tail.length >= 3) {
    const mt = tail.reduce((a, b) => a + b, 0) / tail.length;
    const vt = tail.reduce((a, b) => a + (b - mt) ** 2, 0) / Math.max(1, tail.length - 1);
    const shortSigma = Math.max(1e-6, Math.sqrt(vt));
    return { shortSigma, longSigma };
  }
  return { shortSigma: longSigma, longSigma };
}

function minuteSigma(candles: BtcCandle[]): number {
  // Short-window σ (last 5 candles) catches regime expansion. When BTC breaks
  // out of chop, long-window σ lags 30+ minutes; max(short,long) widens the
  // diffusion in real time so we stop pinning near-cert NOs into breakout candles.
  const { shortSigma, longSigma } = minuteSigmaPair(candles);
  return Math.max(longSigma, shortSigma);
}


// Per-minute drift from the recent slope of log-returns. Captures intra-window
// trend (e.g. BTC ramping into expiry) that mean-zero diffusion ignores.
// Capped to ±0.005 / min so a single spike candle can't dominate.
function minuteDrift(candles: BtcCandle[]): number {
  const tail = candles.slice(-6);
  if (tail.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const r = Math.log(tail[i].c / tail[i - 1].c);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (!rets.length) return 0;
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.max(-0.005, Math.min(0.005, mu));
}

// Conditional prob: given spot now, P(spot at close >= strike). Uses Student-t
// (df=4) for fat tails + recent drift, and clips to [0.02, 0.98] so the model
// can't claim near-certainty on a 15-min BTC window.
// (b) Empirical 0.6× correction for 1-min close-to-close noise (bid/ask bounce
// inflates raw stdev vs true settlement-window variance).
const SIGMA_CORRECTION = 0.6;
const STUDENT_T_DF = 4;

function probAboveCond(
  spot: number,
  strike: number,
  sigmaMin: number,
  minutesRemaining: number,
  muMin: number = 0,
): number {
  const t = Math.max(1 / 60, minutesRemaining);
  const sigma = sigmaMin * SIGMA_CORRECTION * Math.sqrt(t);
  if (sigma <= 0) return spot >= strike ? 0.98 : 0.02;
  const mu = muMin * t;
  const d = (Math.log(strike / spot) - mu) / sigma;
  const pAbove = 1 - studentTCdf(d, STUDENT_T_DF);
  return Math.max(0.02, Math.min(0.98, pAbove));
}

// (c) Pull model toward market when very little time remains — but ONLY when
// the model is LESS confident on the locked side than the market is. If the
// model is more confident than Kalshi (we see spot + time clearly while their
// order book lags), we keep our edge instead of dampening it toward them.
function blendNearExpiry(modelP: number, marketP: number, minsRemaining: number, side: "YES" | "NO"): number {
  if (minsRemaining >= 2) return modelP;
  // Model's confidence in the locked side.
  const modelSideP = side === "YES" ? modelP : 1 - modelP;
  const marketSideP = side === "YES" ? marketP : 1 - marketP;
  // Only blend toward market if model trails market — never dampen high-conviction pins.
  if (modelSideP >= marketSideP) return modelP;
  const w = Math.min(0.85, (2 - minsRemaining) / 2 * 0.85);
  return modelP * (1 - w) + marketP * w;
}

// Forward-vol-aware effective per-minute σ: blend realized 1m σ (backward) with
// Deribit ATM IV (forward). IV is annualized; convert to per-minute: σ_min = atmIv/√525600.
// Weight = 0.6 realized + 0.4 implied when IV is available; fall back to pure realized.
function effectiveSigmaMin(realizedSigmaMin: number, opts: BtcOptions | null): number {
  if (!opts || !Number.isFinite(opts.atmIv) || opts.atmIv <= 0) return realizedSigmaMin;
  const ivPerMin = opts.atmIv / Math.sqrt(525600);
  // Sanity-cap: implied shouldn't drag effective beyond ±3× realized.
  const capped = Math.max(realizedSigmaMin / 3, Math.min(realizedSigmaMin * 3, ivPerMin));
  return 0.6 * realizedSigmaMin + 0.4 * capped;
}

// How many σ of remaining-window move stands between spot and strike.
// >2σ = locked side is ~97% safe; <0.5σ = essentially a coin flip.
function sigmaDistance(spot: number, strike: number, sigmaMin: number, minutesRemaining: number): number {
  if (spot <= 0 || strike <= 0 || sigmaMin <= 0) return 0;
  const t = Math.max(1 / 60, minutesRemaining);
  const stdMove = sigmaMin * SIGMA_CORRECTION * Math.sqrt(t);
  if (stdMove <= 0) return 0;
  return Math.abs(Math.log(spot / strike)) / stdMove;
}

function quarterKelly(p: number, priceYes: number): number {
  const betYes = p > priceYes;
  const price = betYes ? priceYes : 1 - priceYes;
  const prob = betYes ? p : 1 - p;
  if (price <= 0.01 || price >= 0.99) return 0;
  const b = (1 - price) / price;
  const f = (b * prob - (1 - prob)) / b;
  return Math.max(0, Math.min(0.05, f * 0.25));
}

// Find the candle closest to (but not after) a given unix-second timestamp.
function priceAt(candles: BtcCandle[], unixSec: number): number {
  if (!candles.length) return 0;
  let best = candles[0];
  for (const c of candles) {
    if (c.t <= unixSec) best = c;
    else break;
  }
  return best.c;
}

async function fetchExternalProb(ctx: {
  ticker: string; strike: number; spot: number;
  windowOpen: number; minutesRemaining: number; yesPrice: number;
}): Promise<number | null> {
  const url = process.env.CRYPTO_MODEL_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ctx),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const p = Number(j.prob ?? j.yes_prob ?? j.probability);
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    return p;
  } catch { return null; }
}

// ── PHASE 1 · STEP 1 + 2 ────────────────────────────────────────────────────
// Microstructure signals from Binance USDT-perp:
//   Step 1: funding · OI 5m delta · spot–perp basis
//   Step 2: taker buy/sell CVD (last ~60s) · order-book imbalance (top 10)
// Cached 15s. All endpoints public, no auth.
let _microCache: { at: number; data: BtcMicro | null } | null = null;
const MICRO_TTL_MS = 15_000;

async function fetchBinanceMicro(spot: number): Promise<BtcMicro | null> {
  if (_microCache && Date.now() - _microCache.at < MICRO_TTL_MS) return _microCache.data;
  try {
    const nowMs = Date.now();
    const since60s = nowMs - 60_000;
    const since5m = nowMs - 5 * 60_000;
    const [fundingRes, oiRes, oiHistRes, perpRes, tradesRes, trades5mRes, depthRes] = await Promise.all([
      fetch("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
      fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"),
      fetch("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=2"),
      fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT"),
      fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT&startTime=${since60s}&limit=1000`),
      fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=BTCUSDT&startTime=${since5m}&limit=1000`),
      fetch("https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20"),
    ]);
    if (!fundingRes.ok || !oiRes.ok || !perpRes.ok) throw new Error("micro http");

    const funding: any = await fundingRes.json();
    const oi: any = await oiRes.json();
    const perp: any = await perpRes.json();
    const hist: any[] = oiHistRes.ok ? await oiHistRes.json() : [];
    const trades: any[] = tradesRes.ok ? await tradesRes.json() : [];
    const trades5m: any[] = trades5mRes.ok ? await trades5mRes.json() : [];
    const depth: any = depthRes.ok ? await depthRes.json() : { bids: [], asks: [] };

    const fundingRate = Number(funding.lastFundingRate ?? 0);
    const perpPrice = Number(perp.price ?? 0);
    const oiContracts = Number(oi.openInterest ?? 0);
    const oiNotional = oiContracts * perpPrice;
    const basisBps = spot > 0 ? ((perpPrice - spot) / spot) * 10000 : 0;

    let oiDelta5mPct = 0;
    if (hist.length >= 2) {
      const prev = Number(hist[0]?.sumOpenInterestValue ?? hist[0]?.sumOpenInterest ?? 0);
      const curr = Number(hist[1]?.sumOpenInterestValue ?? hist[1]?.sumOpenInterest ?? 0);
      if (prev > 0) oiDelta5mPct = ((curr - prev) / prev) * 100;
    }

    // Taker CVD over the window. `m=true` means buyer is the market maker,
    // so the trade was a SELL aggression; `m=false` means BUY aggression.
    let cvdBuyUsd = 0, cvdSellUsd = 0;
    let whaleBuy1m = 0, whaleSell1m = 0;
    const WHALE_USD = 250_000;
    for (const t of trades) {
      const price = Number(t.p);
      const qty = Number(t.q);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      const usd = price * qty;
      if (t.m) cvdSellUsd += usd;
      else cvdBuyUsd += usd;
      if (usd >= WHALE_USD) {
        if (t.m) whaleSell1m += usd; else whaleBuy1m += usd;
      }
    }
    const totalUsd = cvdBuyUsd + cvdSellUsd;
    const cvdRatio = totalUsd > 0 ? (cvdBuyUsd - cvdSellUsd) / totalUsd : 0;
    const whaleTot1m = whaleBuy1m + whaleSell1m;
    const whaleImbalance1m = whaleTot1m > 0 ? (whaleBuy1m - whaleSell1m) / whaleTot1m : 0;

    // 5-minute whale aggregation from the wider aggTrades window.
    let whaleBuy5m = 0, whaleSell5m = 0, whaleCount5m = 0;
    for (const t of trades5m) {
      const price = Number(t.p);
      const qty = Number(t.q);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      const usd = price * qty;
      if (usd >= WHALE_USD) {
        whaleCount5m++;
        if (t.m) whaleSell5m += usd; else whaleBuy5m += usd;
      }
    }
    const whaleTot5m = whaleBuy5m + whaleSell5m;
    const whaleImbalance5m = whaleTot5m > 0 ? (whaleBuy5m - whaleSell5m) / whaleTot5m : 0;

    // Order-book imbalance: sum sizes for top 10 levels each side.
    const bids: [string, string][] = depth.bids ?? [];
    const asks: [string, string][] = depth.asks ?? [];
    const sumSize = (rows: [string, string][]) =>
      rows.slice(0, 10).reduce((s, [, q]) => s + Number(q || 0), 0);
    const bidSize = sumSize(bids);
    const askSize = sumSize(asks);
    const ofi = bidSize + askSize > 0 ? (bidSize - askSize) / (bidSize + askSize) : 0;

    const bestBid = Number(bids[0]?.[0] ?? 0);
    const bestAsk = Number(asks[0]?.[0] ?? 0);
    const mid = (bestBid + bestAsk) / 2;
    const bookSpreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;

    const data: BtcMicro = {
      fundingRate,
      fundingAnnualBps: fundingRate * 3 * 365 * 10000,
      oiNotional,
      oiDelta5mPct,
      basisBps,
      cvdRatio,
      cvdBuyUsd,
      cvdSellUsd,
      ofi,
      bookSpreadBps,
      whaleBuyUsd1m: whaleBuy1m,
      whaleSellUsd1m: whaleSell1m,
      whaleImbalance1m,
      whaleBuyUsd5m: whaleBuy5m,
      whaleSellUsd5m: whaleSell5m,
      whaleImbalance5m,
      whaleCount5m,
    };
    _microCache = { at: Date.now(), data };
    return data;
  } catch {
    _microCache = { at: Date.now(), data: null };
    return null;
  }
}

// Logistic adjustment: shift YES probability by a small bounded amount when
// microstructure signals lean one way. Bullish bias ⇒ raise YES prob.
//
// Conservative, hand-tuned coefficients. Bounded at ±6 points so no single
// noisy signal can flip a call by itself.
function microAdjustment(p: number, m: BtcMicro | null, secondsToClose: number): { p: number; deltaPts: number } {
  if (!m || secondsToClose <= 30 || p <= 0 || p >= 1) return { p, deltaPts: 0 };

  // z-style: positive = bullish for next 15m, negative = bearish.
  // Funding > +0.01% / 8h = crowded longs (bearish lean — paying to be long).
  const fundingZ = -Math.max(-3, Math.min(3, m.fundingRate / 0.00005));
  // OI rising in same direction as basis = fresh leverage piling in (short-term trend follow).
  const oiZ = Math.max(-2, Math.min(2, m.oiDelta5mPct / 0.5)) * Math.sign(m.basisBps || 1);
  // Basis blowout: |basis| > 5bps suggests imbalance; sign = direction of pressure.
  const basisZ = Math.max(-2, Math.min(2, m.basisBps / 5));
  // Taker CVD: aggressive flow leads spot on minute horizon. Linear in ratio.
  const cvdZ = Math.max(-2, Math.min(2, m.cvdRatio * 4)); // ratio 0.5 → z=2
  // Order-book imbalance: classic OFI alpha.
  const ofiZ = Math.max(-2, Math.min(2, m.ofi * 3));
  // Whale aggression: large fills (≥$250k) lead spot on minute horizon.
  // Use 1m for recency, blended with 5m for stability.
  const whaleZ = Math.max(-2, Math.min(2, (m.whaleImbalance1m * 0.7 + m.whaleImbalance5m * 0.3) * 3));

  const score =
    0.22 * fundingZ +
    0.13 * oiZ +
    0.22 * basisZ +
    0.18 * cvdZ +
    0.12 * ofiZ +
    0.13 * whaleZ;
  // Convert score → logit shift, cap at ±0.27 logit (≈ ±6 prob points near 0.5).
  const logitShift = Math.max(-0.27, Math.min(0.27, score * 0.07));
  const eps = 1e-6;
  const logit = Math.log(Math.max(eps, p) / Math.max(eps, 1 - p));
  const pNew = 1 / (1 + Math.exp(-(logit + logitShift)));
  return { p: pNew, deltaPts: (pNew - p) * 100 };
}


// ── PHASE 1 · STEP 3 ────────────────────────────────────────────────────────
// Deribit options-implied prob + 25Δ skew. Pulls nearest BTC expiry, extracts
// ATM IV and 25-delta wings, then prices P(S_T >= K) via Black–Scholes with a
// small skew-induced drift. Blended 50/50 with diffusion when available.
// Cached 60s.
let _optionsCache: { at: number; data: BtcOptions | null } | null = null;
const OPTIONS_TTL_MS = 60_000;

interface DeribitBookRow {
  instrument_name: string;
  mark_iv?: number;          // % (e.g. 55 = 0.55)
  underlying_price?: number;
  mid_price?: number;
}

async function fetchDeribitOptions(): Promise<BtcOptions | null> {
  if (_optionsCache && Date.now() - _optionsCache.at < OPTIONS_TTL_MS) return _optionsCache.data;
  try {
    const res = await fetch(
      "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option",
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`deribit ${res.status}`);
    const json: any = await res.json();
    const rows: DeribitBookRow[] = json.result ?? [];
    if (!rows.length) throw new Error("deribit empty");

    // Parse: BTC-30JUN26-65000-C
    type Parsed = { expiryMs: number; strike: number; type: "C" | "P"; iv: number; underlying: number };
    const parsed: Parsed[] = [];
    for (const r of rows) {
      const parts = r.instrument_name.split("-");
      if (parts.length !== 4) continue;
      const [, dateStr, strikeStr, cp] = parts;
      const expiryMs = parseDeribitDate(dateStr);
      const strike = Number(strikeStr);
      const iv = Number(r.mark_iv);
      const underlying = Number(r.underlying_price);
      if (!Number.isFinite(expiryMs) || !Number.isFinite(strike) || !Number.isFinite(iv) || iv <= 0) continue;
      if (cp !== "C" && cp !== "P") continue;
      parsed.push({ expiryMs, strike, type: cp, iv: iv / 100, underlying });
    }
    if (!parsed.length) throw new Error("deribit parse empty");

    // Pick nearest expiry strictly in the future (≥ 1h to skip stale).
    const now = Date.now();
    const expiries = Array.from(new Set(parsed.map(p => p.expiryMs))).filter(t => t - now > 3600_000).sort((a, b) => a - b);
    if (!expiries.length) throw new Error("no future expiry");
    const expiryMs = expiries[0];
    const slice = parsed.filter(p => p.expiryMs === expiryMs);
    const underlying = slice.find(p => Number.isFinite(p.underlying) && p.underlying > 0)?.underlying ?? 0;
    if (!underlying) throw new Error("no underlying");
    const yearsToExpiry = (expiryMs - now) / (365 * 24 * 3600 * 1000);

    // ATM IV: average call+put IV at strike nearest to underlying.
    const nearestStrike = slice.reduce((best, p) =>
      Math.abs(p.strike - underlying) < Math.abs(best - underlying) ? p.strike : best,
      slice[0].strike,
    );
    const atmRows = slice.filter(p => p.strike === nearestStrike);
    const atmIv = atmRows.reduce((s, p) => s + p.iv, 0) / atmRows.length;

    // 25Δ approximation: target moneyness ln(K/S) ≈ ±0.674 * IV * sqrt(T).
    const z = 0.674;
    const targetUp = underlying * Math.exp(z * atmIv * Math.sqrt(Math.max(yearsToExpiry, 1 / 365)));
    const targetDn = underlying * Math.exp(-z * atmIv * Math.sqrt(Math.max(yearsToExpiry, 1 / 365)));
    const calls = slice.filter(p => p.type === "C");
    const puts = slice.filter(p => p.type === "P");
    const ivCall25 = nearestIv(calls, targetUp) ?? atmIv;
    const ivPut25 = nearestIv(puts, targetDn) ?? atmIv;
    const skew25 = atmIv > 0 ? (ivPut25 - ivCall25) / atmIv : 0;

    const data: BtcOptions = {
      expiryMs, yearsToExpiry, underlying, atmIv, skew25, ivPut25, ivCall25,
      sampleCount: slice.length,
    };
    _optionsCache = { at: Date.now(), data };
    return data;
  } catch {
    _optionsCache = { at: Date.now(), data: null };
    return null;
  }
}

function nearestIv(rows: { strike: number; iv: number }[], target: number): number | null {
  if (!rows.length) return null;
  let best = rows[0];
  for (const r of rows) if (Math.abs(r.strike - target) < Math.abs(best.strike - target)) best = r;
  return best.iv;
}

function parseDeribitDate(s: string): number {
  // e.g. "30JUN26" → 30 Jun 2026 08:00 UTC (Deribit expiries settle 08:00 UTC).
  const m = s.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return NaN;
  const day = Number(m[1]);
  const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(m[2]);
  if (mon < 0) return NaN;
  const year = 2000 + Number(m[3]);
  return Date.UTC(year, mon, day, 8, 0, 0);
}

// Black–Scholes risk-neutral P(S_T >= K) with skew-induced drift.
// For 15-min Kalshi window: use Deribit ATM IV (annualized) as sigma, and
// nudge mu by the 25Δ skew so put-heavy markets push prob down on upside.
function optionsImpliedProb(
  spot: number, strike: number, opts: BtcOptions | null, secondsToClose: number,
): number | null {
  if (!opts || spot <= 0 || strike <= 0 || secondsToClose <= 0) return null;
  const T = secondsToClose / (365 * 24 * 3600); // years
  const sigma = opts.atmIv * Math.sqrt(T);
  if (sigma <= 0) return spot >= strike ? 1 : 0;
  // Skew → small directional drift. Cap |skew25| at 0.15 (15%) influence.
  const skew = Math.max(-0.15, Math.min(0.15, opts.skew25));
  const mu = -skew * opts.atmIv * Math.sqrt(T) * 0.5; // bullish drift if puts > calls? No — skew>0 means downside fear, so mu<0. Sign flipped intentionally: bearish skew should LOWER P(up). Recheck: skew>0 → mu=-0.5*positive=negative → reduces P(S_T>K). Correct.
  const d = (Math.log(strike / spot) - mu + 0.5 * sigma * sigma) / sigma;
  return 1 - normCdf(d);
}



// Internal implementation, callable from any server-side context (including
// public server routes without auth). getBtcMarkets is a thin wrapper.
export async function computeBtcMarkets(): Promise<BtcMarketsResult> {

    const [evJson, candles, candles5mReal] = await Promise.all([
      kalshiFetch(`/events?status=open&with_nested_markets=true&series_ticker=KXBTC15M&limit=50`),
      fetchBtcCandles().catch(() => [] as BtcCandle[]),
      fetchBtcCandles5m().catch(() => [] as BtcCandle[]),
    ]);

    // `recent` (60 1m) — used by legacy σ/drift math that has been tuned for
    // that window; do not widen or the sigma calcs shift under everything else.
    const recent = candles.slice(-60);
    // `taCandles1m` — full 300 1m candles (5h). Feeds the TA engine so EMA169,
    // RSI14, MACD, and Bollinger can actually compute instead of returning null.
    const taCandles1m = candles;
    const candleSpot = recent.length ? recent[recent.length - 1].c : 0;
    // (a) Consolidated multi-venue spot (Coinbase + Binance + Kraken median).
    const { median: spot, ticks: venueTicks } = await fetchConsolidatedSpotDetailed(candleSpot);
    // Shadow-log per-venue + consolidated ticks for jump-feature extraction. Never blocks.
    recordSpotTick(spot, venueTicks);
    const { shortSigma, longSigma } = minuteSigmaPair(recent);
    const sigmaRaw = Math.max(shortSigma, longSigma);
    const driftRaw = minuteDrift(recent);
    const now = Date.now();
    const hasExternal = !!process.env.CRYPTO_MODEL_URL;

    // (d) Microstructure features — funding, OI delta, basis, CVD, OFI.
    // (e) Deribit options-implied IV + 25Δ skew (Phase 1 · Step 3).
    // (f) Self-learning Platt calibration from settled predictions (Step 4).
    const [micro, options, calibState] = await Promise.all([
      fetchBinanceMicro(spot),
      fetchDeribitOptions(),
      (async () => {
        try {
          const { getCalibrator } = await import("./cryptoCalibrator.server");
          return await getCalibrator();
        } catch (e) {
          console.warn("calibrator load failed:", e);
          return null;
        }
      })(),
    ]);

    // (g) AI regime classifier (5-min cached). Returns σ multiplier + drift bias
    // applied to every market for this tick — captures macro context (chop vs
    // breakout vs squeeze) that pure stats can't see.
    const regimeState = await (async () => {
      try {
        const { getRegime } = await import("./cryptoRegime.server");
        return await getRegime({
          spot, sigmaShort: shortSigma, sigmaLong: longSigma, drift: driftRaw,
          micro, options, recentCandles: recent,
        });
      } catch (e) {
        console.warn("regime classifier failed:", e);
        return null;
      }
    })();

    // ── Chart verdict (global, once per request) ───────────────────────────
    // Legacy chart verdict still uses the short bucketed 5m array — do NOT
    // switch it to the real 5m feed without re-tuning its thresholds.
    const candles5m: BtcCandle[] = (() => {
      if (recent.length < 5) return [];
      const buckets: BtcCandle[] = [];
      for (let i = 0; i + 5 <= recent.length; i += 5) {
        const g = recent.slice(i, i + 5);
        buckets.push({
          t: g[0].t,
          o: g[0].o,
          h: Math.max(...g.map(c => c.h)),
          l: Math.min(...g.map(c => c.l)),
          c: g[g.length - 1].c,
          v: g.reduce((a, c) => a + c.v, 0),
        });
      }
      return buckets;
    })();
    const chartVerdict = (() => {
      try { return getChartVerdict(recent, candles5m); }
      catch (e) { console.warn("chart verdict failed:", e); return null; }
    })();
    // Real TA engine v2 (live-wired): confluence scorer across EMA9/21/55/145/169,
    // VWAP, structure, MACD, RSI, Bollinger, candles, plus acceleration deltas.
    // Uses the DEEP 1m (300 bars) + REAL 5m (300 bars) feeds so every indicator
    // can actually compute instead of falling back to null.
    const taSource5m = candles5mReal.length >= 35 ? candles5mReal : candles5m;
    const taScoreRes: TaScoreResult | null = (() => {
      try { return computeTaScore(taCandles1m, taSource5m); }
      catch (e) { console.warn("ta score failed:", e); return null; }
    })();


    // Apply regime knobs to σ and drift before they feed the diffusion model.
    const sigma = sigmaRaw * (regimeState?.sigmaMult ?? 1);
    const drift = Math.max(-0.005, Math.min(0.005, driftRaw + (regimeState?.driftBiasPerMin ?? 0)));
    const applyCalib = await (async () => {
      try {
        const { applyCalibration } = await import("./cryptoCalibrator.server");
        return applyCalibration;
      } catch { return null; }
    })();

    // Forward-vol blended per-minute σ (realized + Deribit IV). Used by the
    // diffusion prob and by the sigmaDistance "how safe is this pin" metric.
    const sigmaEff = effectiveSigmaMin(sigma, options);

    const events = (evJson.events ?? []) as any[];
    const markets: BtcMarket[] = [];

    // Lock model side per ticker: first snapshot wins for the life of the
    // market, so the UI never flips UP↔DOWN mid-window even if live prob
    // drifts across 50%.
    const allTickers: string[] = [];
    for (const e of events) for (const m of e.markets ?? []) if (m?.ticker) allTickers.push(m.ticker);
    const lockedSides = await (async () => {
      try {
        const { getLockedSides } = await import("./cryptoPredictions.server");
        return await getLockedSides(allTickers);
      } catch { return new Map<string, "YES" | "NO">(); }
    })();

    // Fetch shared BTC gate config once per snapshot — cached 30s in memory.
    const btcGateCfg = await getBtcGateConfig();

    // Losing-Streak Circuit Breaker: count consecutive most-recent settled
    // losses across all BTC tickers. 48h data shows WR drops 50%→41% after
    // 2 straight losses; the streak feeds the gate to brake at 2 and skip at 3.
    const { lossStreak, prevOutcome1, prevOutcome2 } = await (async () => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("btc_model_predictions")
          .select("was_correct,outcome,close_time")
          .not("was_correct", "is", null)
          .not("outcome", "is", null)
          .order("close_time", { ascending: false })
          .limit(10);
        if (!data) return { lossStreak: 0, prevOutcome1: undefined, prevOutcome2: undefined };
        let n = 0;
        for (const row of data) {
          if (row.was_correct === false) n++;
          else break;
        }
        const o1 = data[0]?.outcome === "YES" || data[0]?.outcome === "NO" ? data[0].outcome as "YES" | "NO" : undefined;
        const o2 = data[1]?.outcome === "YES" || data[1]?.outcome === "NO" ? data[1].outcome as "YES" | "NO" : undefined;
        return { lossStreak: n, prevOutcome1: o1, prevOutcome2: o2 };
      } catch { return { lossStreak: 0, prevOutcome1: undefined, prevOutcome2: undefined }; }
    })();





    for (const e of events) {
      for (const m of e.markets ?? []) {
        if (m.status !== "active") continue;
        // Kalshi BTC 15m markets carry the level in different fields depending
        // on market type: "above" uses floor_strike, "below" uses cap_strike,
        // and some payloads only put the number in the human subtitle (e.g.
        // "Above $109,750.00"). Fall back through all of them so we never
        // silently treat a real market as strike=0 (which would render "$0" in
        // Top Pick and poison the model prob).
        const parseSubtitleStrike = (s: unknown): number => {
          if (typeof s !== "string") return 0;
          const match = s.match(/\$([\d,]+(?:\.\d+)?)/);
          if (!match) return 0;
          const n = Number(match[1].replace(/,/g, ""));
          return Number.isFinite(n) ? n : 0;
        };
        const strike =
          Number(m.floor_strike) ||
          Number((m as { cap_strike?: number | string }).cap_strike) ||
          Number((m as { strike?: number | string }).strike) ||
          parseSubtitleStrike(m.yes_sub_title) ||
          parseSubtitleStrike((m as { title?: string }).title) ||
          0;
        if (!(strike > 0)) continue; // skip malformed rows instead of publishing strike=$0
        const yesPrice = Number(m.last_price_dollars ?? m.yes_bid_dollars ?? 0);
        const openTime = m.open_time ?? null;
        const closeTime = m.close_time ?? m.expected_expiration_time ?? null;
        const closeMs = closeTime ? new Date(closeTime).getTime() : now + 15 * 60_000;
        const openMs = openTime ? new Date(openTime).getTime() : closeMs - 15 * 60_000;
        const minsRemaining = Math.max(0, (closeMs - now) / 60_000);
        const secondsToClose = Math.max(0, Math.round((closeMs - now) / 1000));
        const windowOpen = priceAt(recent, Math.floor(openMs / 1000)) || spot;
        const realizedMoveBps = windowOpen > 0 ? ((spot - windowOpen) / windowOpen) * 10000 : 0;

        let pDiffusion = spot > 0 && strike > 0
          ? probAboveCond(spot, strike, sigmaEff, minsRemaining, drift)
          : 0.5;
        let source: BtcMarket["modelSource"] = "intra-window-diffusion";

        const ext = await fetchExternalProb({
          ticker: m.ticker, strike, spot, windowOpen,
          minutesRemaining: minsRemaining, yesPrice,
        });
        if (ext !== null) { pDiffusion = ext; source = "external"; }

        // (e) Blend in Deribit options-implied prob (50/50 when available).
        const pOpt = optionsImpliedProb(spot, strike, options, secondsToClose);
        const pBase = pOpt !== null ? 0.5 * pDiffusion + 0.5 * pOpt : pDiffusion;
        const optionsBlendPts = pOpt !== null ? (pBase - pDiffusion) * 100 : 0;

        // (d) Apply microstructure logistic adjustment on top of blended base prob.
        const adj = microAdjustment(pBase, micro, secondsToClose);
        let p = adj.p;

        // (f) Self-learning Platt calibration (per time-to-close bucket).
        const cal = applyCalib ? applyCalib(p, secondsToClose, calibState) : { p, deltaPts: 0, bucket: "ge600", active: false };
        p = cal.p;

        // Snapshot pre-blend prob for mean-reversion sanity clamp below.
        const pPreBlend = p;

        // (f2) TA v2 soft blend into model_prob (LIVE ±15pt, re-enabled 2026-07-23).

        // Previous ±25pt blend broke calibration; ±15pt cap is deliberately gentler.
        // Only shifts prob toward TA direction; side may still flip when |shift| > |p-0.5|.
        let taBlendPts = 0;
        if (taScoreRes && Number.isFinite(taScoreRes.score)) {
          const clamped = Math.max(-100, Math.min(100, taScoreRes.score));
          const shift = (clamped / 100) * 0.15; // ±0.15 max
          const pBefore = p;
          p = Math.max(0.01, Math.min(0.99, p + shift));
          taBlendPts = (p - pBefore) * 100;
        }

        // (f3) Chart Verdict blend — trendlines + S/R + structure (LIVE ±10pt, 2026-07-23).
        // Smaller cap than TA v2 to avoid double-counting overlapping signals.
        // shift = direction_sign * confidence * 0.10
        //
        // (f3b) BREAKOUT BOOSTER (2026-07-23): when price is living OUTSIDE the
        // channel on the strike-favorable side and no spike-rejection has fired,
        // force chart verdict direction+confidence high. Teaches the model that
        // "close beyond trendline in the direction of the strike side" is a
        // strong directional signal — which is what the eye reads on the chart.
        let chartBlendPts = 0;
        let boosterFired: "up" | "down" | null = null;
        if (chartVerdict?.combined) {
          let dir = chartVerdict.combined.direction as "YES" | "NO" | "neutral";
          let conf = Math.max(0, Math.min(1, chartVerdict.combined.confidence ?? 0));

          // Breakout booster: recompute trendlines on the same 1m candle set.
          try {
            const trend = detectTrendlines(recent as any);
            const spike = detectSpike(recent as any, trend);
            const upperNow = trend.upperAtNow;
            const lowerNow = trend.lowerAtNow;
            const spotAboveStrike = spot > strike;
            const spotBelowStrike = spot < strike;
            // Upside breakout: close above upper trendline AND spot > strike
            // AND no bearish spike-rejection printing against us.
            if (upperNow != null && spot > upperNow && spotAboveStrike &&
                !(spike.detected && spike.direction === "down")) {
              dir = "YES";
              conf = Math.max(conf, 0.75);
              boosterFired = "up";
            } else if (lowerNow != null && spot < lowerNow && spotBelowStrike &&
                !(spike.detected && spike.direction === "up")) {
              dir = "NO";
              conf = Math.max(conf, 0.75);
              boosterFired = "down";
            }
          } catch (e) { /* trendline failure is non-fatal */ }

          const sign = dir === "YES" ? 1 : dir === "NO" ? -1 : 0;
          if (sign !== 0 && conf > 0) {
            const shift = sign * conf * 0.10; // ±0.10 max
            const pBefore = p;
            p = Math.max(0.01, Math.min(0.99, p + shift));
            chartBlendPts = (p - pBefore) * 100;
          }
        }
        void boosterFired; // reserved for future decision-log field

        // ── REVERSION SANITY VETOS (2026-07-23) ────────────────────────────
        // Three soft caps that never flip a pick — they only *moderate*
        // conviction when the model would otherwise anchor too hard on a
        // signal that historically mean-reverts inside a 15m window.
        //   sig1  Oversold/overbought bounce  (RSI extreme + BB %B extreme, ≥8m left)
        //   sig2  Distance/σ sanity           (spot well within one std-dev of strike)
        //   sig3  VWAP magnet                 (spot stretched from VWAP toward strike)
        // Applied as clamps toward the pre-blend prob (never crosses 0.5).
        {
          const secLeft = secondsToClose;
          const minsLeft = Math.max(0, secLeft / 60);
          // sigmaEff is per-minute stddev of log returns → expected move ≈ spot*σ*sqrt(min).
          const expectedMoveUsd = spot > 0 && sigmaEff > 0
            ? spot * sigmaEff * Math.sqrt(Math.max(0.5, minsLeft))
            : 0;
          const distSigma = expectedMoveUsd > 0
            ? Math.abs(spot - strike) / expectedMoveUsd
            : Infinity;

          // Sig 2 — Distance/σ < 0.6: TA/chart shifts are too aggressive when
          // the market is well within one std-dev of the strike. Pull p halfway
          // back toward pre-blend (physics-dominated).
          if (distSigma < 0.6 && Number.isFinite(distSigma)) {
            p = pPreBlend + (p - pPreBlend) * 0.5;
          }

          // Sig 1 — Oversold-bounce cap. NO conviction (=1-p) capped at 0.75
          // when TA is deep oversold with ≥ 8 min left. Symmetric for YES.
          const rsi5 = taScoreRes?.rsi5m ?? null;
          const pctB = taScoreRes?.bb5mPctB ?? null;
          if (secLeft >= 480 && rsi5 != null && pctB != null) {
            if (p < 0.5 && rsi5 <= 35 && pctB <= 0.10) {
              // Deep oversold — cap NO conviction at 75%.
              p = Math.max(p, 0.25);
            } else if (p > 0.5 && rsi5 >= 65 && pctB >= 0.90) {
              // Deep overbought — cap YES conviction at 75%.
              p = Math.min(p, 0.75);
            }
          }

          // Sig 3 — VWAP magnet. When spot is stretched away from VWAP but the
          // strike sits between spot and VWAP, VWAP acts as a magnet pulling
          // price back through the strike.
          const vwapPct = taScoreRes?.vwapDistPct ?? null;
          if (secLeft >= 480 && vwapPct != null) {
            const spotBelowStrike = spot < strike;
            const spotAboveStrike = spot > strike;
            if (p < 0.5 && vwapPct <= -0.5 && spotBelowStrike) {
              // NO pick with spot stretched below VWAP AND below strike → VWAP
              // above pulls through strike. Cap NO at 75%.
              p = Math.max(p, 0.25);
            } else if (p > 0.5 && vwapPct >= 0.5 && spotAboveStrike) {
              // Mirror for YES side.
              p = Math.min(p, 0.75);
            }
          }
        }
        // ── end reversion vetos ─────────────────────────────────────────────



        // ── FREEZE-SIDE GUARD REMOVED (2026-07-22 rollback) ──
        // The lockedSide-first behavior kept the model stuck on the first
        // snapshot's pick even when live probability drifted across 50%.
        // Side now always follows the current calibrated probability.
        const tentativeSide: "YES" | "NO" = p >= 0.5 ? "YES" : "NO";

        // (c) Asymmetric blend toward market in the final 2 minutes — only when
        // model trails market on the locked side, never when we're MORE confident
        // than Kalshi (we read spot+time live; their book lags).
        if (yesPrice > 0 && yesPrice < 1) p = blendNearExpiry(p, yesPrice, minsRemaining, tentativeSide);




        const rawEdgePts = (p - yesPrice) * 100;
        // Side always follows current calibrated model prob (no freeze-side).
        // eslint-disable-next-line prefer-const
        let side: "YES" | "NO" = p >= 0.5 ? "YES" : "NO";
        // eslint-disable-next-line prefer-const
        let edgePts = side === "YES" ? rawEdgePts : -rawEdgePts;
        const edgeAbs = Math.abs(edgePts);
        const kelly = quarterKelly(p, yesPrice);

        // Time/vol safety margin — how many σ from strike (locked side).
        const sigDist = sigmaDistance(spot, strike, sigmaEff, minsRemaining);

        // ── STEP 5 · Edge gate (extracted to cryptoBtcGate.ts for unit-test coverage) ──
        const bucketFit = calibState?.buckets.find(b => b.bucket === cal.bucket);
        const { requiredEdgePts, parts: edgeParts } = computeRequiredEdgePts({
          side, secondsToClose, micro,
          calibBrier: bucketFit ? bucketFit.brier : null,
          calibN: bucketFit ? bucketFit.n : 0,
        });
        const tBase = edgeParts.base;
        const tCalib = edgeParts.calib;
        const tTime = edgeParts.time;
        const tSpread = edgeParts.spread;
        const tRegime = edgeParts.regime;
        const tWhale = edgeParts.whale;

        const gapAnalysis = computeGapAnalysis({ spot, strike, side, sigmaEff, secondsToClose, micro });
        const sideConf = side === "YES" ? p : 1 - p;
        const { gateAction, gateReason } = evaluateGate({
          side, secondsToClose, yesPrice, sigDist, edgeAbs, requiredEdgePts, kelly, gap: gapAnalysis,
          sideConf, spot, strike, lossStreak, prevOutcome1, prevOutcome2,
        });



        // liveSide == side now (freeze-side guard removed).
        const rawDir: "YES" | "NO" = side;
        const cvDir = chartVerdict?.combined.direction ?? "neutral";
        const cvConf = chartVerdict?.combined.confidence ?? 0;
        const elapsedMinLive = 15 - minsRemaining;
        const anchorZLive = (() => {
          const em = Math.max(0.5, elapsedMinLive);
          const denom = windowOpen * sigmaEff * Math.sqrt(em);
          return denom > 0 ? (spot - windowOpen) / denom : 0;
        })();
        const liveSide: "YES" | "NO" = side;

        // ── Shared central gate (universal — every automatic path uses this) ──
        const yesAskDollars = Number(m.yes_ask_dollars ?? 0);
        const noAskDollars = Number(m.no_ask_dollars ?? 0);
        let entryGate = evaluateBtcEntry({
          lockedSide: side,
          liveSide,
          modelProb: p,
          yesAsk: yesAskDollars > 0 && yesAskDollars < 1 ? yesAskDollars : null,
          noAsk: noAskDollars > 0 && noAskDollars < 1 ? noAskDollars : null,
          config: btcGateCfg,
        });

        // ── TA VETO (post-gate override) ─────────────────────────────
        // TA does NOT push probability anymore. It can only VETO a BET when
        // strongly opposing near the strike (chop zone), where the model is
        // easily whipsawed by the last tick.
        if (entryGate.action === "BET" && taScoreRes) {
          const taDir: "YES" | "NO" | null =
            taScoreRes.score >= 40 ? "YES" : taScoreRes.score <= -40 ? "NO" : null;
          const nearStrike = Math.abs(sigDist) < 0.30;
          if (taDir && taDir !== side && nearStrike) {
            entryGate = {
              ...entryGate,
              action: "PASS",
              reason: `ta_veto — TA score ${taScoreRes.score.toFixed(0)} opposes ${side} near strike (σ-dist ${sigDist.toFixed(2)})`,
              allReasons: [...entryGate.allReasons, `ta_veto (score=${taScoreRes.score.toFixed(0)}, σ=${sigDist.toFixed(2)})`],
            };
          }
        }

        // ── KALSHI TIMING GATE (post-gate override) ──────────────────
        // Only fire when the market ask is in the sweet band [0.40, 0.75]
        // AND time-to-close is 2–6 minutes. Outside this window edge is
        // eaten by fees, price run-up, or last-second reversion.
        if (entryGate.action === "BET") {
          const ask = entryGate.selectedSideAsk;
          const timingOK = secondsToClose >= 120 && secondsToClose <= 360;
          const priceOK = ask !== null && ask >= 0.40 && ask <= 0.75;
          if (!timingOK || !priceOK) {
            const why: string[] = [];
            if (!timingOK) why.push(`ttc ${secondsToClose}s outside [120, 360]`);
            if (!priceOK) why.push(`ask ${ask !== null ? (ask * 100).toFixed(0) + "¢" : "n/a"} outside [40¢, 75¢]`);
            entryGate = {
              ...entryGate,
              action: "PASS",
              reason: `timing_gate — ${why.join(" · ")}`,
              allReasons: [...entryGate.allReasons, `timing_gate (${why.join(", ")})`],
            };
          }
        }

        // ── STRIKE STUDY ENGINE (first 150s of every 15m window) ─────────
        // Live-analyze all TA tools *relative to this window's strike*:
        //   • Trendline break events (spot vs upper/lower over last 3 x 1m)
        //   • S/R proximity (nearest support & resistance vs strike)
        //   • Strike-cross count in the last 150s (chop signal)
        //   • Spot-side stability (% of last-3-candle closes above vs below strike)
        //   • Structure bias (HH/HL vs LH/LL) + VWAP position vs strike
        //   • Chart verdict + TA v2 alignment with the selected side
        // During warm-up we OBSERVE only (no bet). At t≥150s we emit a rich
        // SOLID / WEAK / CHOPPY verdict from all findings above.
        const WARMUP_SECONDS = 150;
        const windowElapsedSec = Math.max(0, Math.round((now - openMs) / 1000));
        const studying = windowElapsedSec < WARMUP_SECONDS;
        const studyingSecondsLeft = studying ? Math.max(0, WARMUP_SECONDS - windowElapsedSec) : 0;

        // Build the study report on EVERY tick (used for both warm-up progress
        // display and post-warm-up verdict). All inputs come from data already
        // computed for this snapshot — no extra I/O.
        const study = (() => {
          const findings: string[] = [];

          // 1. Trendline geometry + break events (last 3 x 1m closes)
          let trendlineNote = "";
          let breakoutSide: "up" | "down" | null = null;
          let trendlineHolds = false;
          try {
            const t = detectTrendlines(recent as any);
            const upperNow = t.upperAtNow;
            const lowerNow = t.lowerAtNow;
            const last3 = recent.slice(-3);
            if (upperNow != null && last3.every(c => c.c > upperNow)) {
              breakoutSide = "up";
              trendlineNote = `↑ broke ABOVE upper channel (${upperNow.toFixed(0)}) on last 3 x 1m closes`;
            } else if (lowerNow != null && last3.every(c => c.c < lowerNow)) {
              breakoutSide = "down";
              trendlineNote = `↓ broke BELOW lower channel (${lowerNow.toFixed(0)}) on last 3 x 1m closes`;
            } else if (upperNow != null && lowerNow != null) {
              const inside = spot > lowerNow && spot < upperNow;
              trendlineHolds = inside;
              trendlineNote = inside
                ? `inside channel [${lowerNow.toFixed(0)} – ${upperNow.toFixed(0)}]`
                : `at edge (spot ${spot.toFixed(0)} vs U ${upperNow.toFixed(0)} / L ${lowerNow.toFixed(0)})`;
            } else {
              trendlineNote = "insufficient swings for channel";
            }
          } catch { trendlineNote = "trendline calc failed"; }
          if (trendlineNote) findings.push(`trendline: ${trendlineNote}`);

          // 2. Strike crossings in last 150s (chop signal)
          const studyWindow = recent.slice(-3); // ~3 minutes of 1m candles
          let crossCount = 0;
          for (let i = 1; i < studyWindow.length; i++) {
            const a = studyWindow[i - 1], b = studyWindow[i];
            const aAbove = a.c > strike;
            const bAbove = b.c > strike;
            if (aAbove !== bAbove) crossCount++;
          }
          // Also count within-candle crossings (high/low straddles strike)
          let straddleCount = 0;
          for (const c of studyWindow) {
            if (c.h >= strike && c.l <= strike) straddleCount++;
          }
          findings.push(`strike-cross: ${crossCount} close-flip${crossCount === 1 ? "" : "s"}, ${straddleCount}/${studyWindow.length} candles straddle strike`);

          // 3. Side-stability during study window
          const aboveCount = studyWindow.filter(c => c.c > strike).length;
          const belowCount = studyWindow.filter(c => c.c < strike).length;
          const sideStable = aboveCount === studyWindow.length || belowCount === studyWindow.length;
          const stableSide: "above" | "below" | "mixed" =
            aboveCount === studyWindow.length ? "above"
            : belowCount === studyWindow.length ? "below" : "mixed";
          findings.push(`spot-vs-strike: ${aboveCount}↑ / ${belowCount}↓ (${sideStable ? `held ${stableSide}` : "mixed"})`);

          // 4. Chart verdict alignment with model side
          const chartAligns = cvDir === side && cvConf >= 0.35;
          const chartOpposes = (cvDir === "YES" || cvDir === "NO") && cvDir !== side && cvConf >= 0.50;
          findings.push(`chart-verdict: ${cvDir} ${(cvConf * 100).toFixed(0)}% ${chartAligns ? "✓aligns" : chartOpposes ? "✗opposes" : "~neutral"} with ${side}`);

          // 5. TA v2 stack alignment
          const taScoreVal = taScoreRes?.score ?? 0;
          const taAligns  = (side === "YES" && taScoreVal >= 25) || (side === "NO" && taScoreVal <= -25);
          const taOpposes = (side === "YES" && taScoreVal <= -25) || (side === "NO" && taScoreVal >= 25);
          findings.push(`TA-v2 stack: ${taScoreVal >= 0 ? "+" : ""}${taScoreVal.toFixed(0)} ${taAligns ? "✓aligns" : taOpposes ? "✗opposes" : "~neutral"}`);

          // 6. Sigma distance from strike (physics safety margin)
          const nearStrike = Math.abs(sigDist) < 0.30;
          const safeDist   = Math.abs(sigDist) >= 0.60;
          findings.push(`σ-distance: ${sigDist.toFixed(2)}σ from strike (${safeDist ? "safe cushion" : nearStrike ? "near strike – fragile" : "moderate"})`);

          // 7. Recent-window chop pattern (last 2 outcomes flipping)
          const recentChop = prevOutcome1 !== null && prevOutcome2 !== null && prevOutcome1 !== prevOutcome2;
          if (recentChop) findings.push(`history: last 2 outcomes FLIPPED (chop regime)`);

          // 8. Momentum agreement with side (from gapAnalysis)
          const momOk = gapAnalysis.momentumAlignsWithSide;
          findings.push(`momentum: ${gapAnalysis.momentumSign > 0 ? "↑" : gapAnalysis.momentumSign < 0 ? "↓" : "—"} ${momOk ? "with" : "vs"} ${side}`);

          return {
            findings,
            breakoutSide,
            trendlineHolds,
            crossCount,
            straddleCount,
            sideStable,
            stableSide,
            chartAligns,
            chartOpposes,
            taAligns,
            taOpposes,
            nearStrike,
            safeDist,
            recentChop,
            momOk,
            taScoreVal,
          };
        })();

        let strikeVerdict: "SOLID" | "WEAK" | "CHOPPY" | null = null;
        let strikeVerdictReason = "";

        if (studying) {
          entryGate = {
            ...entryGate,
            action: "PASS",
            reason: `strike_study — observing (${studyingSecondsLeft}s left) · ${study.findings.slice(0, 2).join(" · ")}`,
            allReasons: [...entryGate.allReasons, `strike_study (${studyingSecondsLeft}s left)`],
          };
        } else {
          // ── POST-STUDY VERDICT ─────────────────────────────────────────
          // Confluence scoring: each aligning signal +1, each opposing −1.
          // The strike-relative pieces (breakout on our side, side-stability,
          // strike-cross count) get double weight because they reflect what
          // ACTUALLY printed against the strike during the study window.
          const strikeBreakForUs =
            (study.breakoutSide === "up" && side === "YES") ||
            (study.breakoutSide === "down" && side === "NO");
          const strikeBreakAgainst =
            (study.breakoutSide === "up" && side === "NO") ||
            (study.breakoutSide === "down" && side === "YES");
          const sideStableForUs = study.sideStable &&
            ((study.stableSide === "above" && side === "YES") ||
             (study.stableSide === "below" && side === "NO"));
          const sideStableAgainst = study.sideStable &&
            ((study.stableSide === "above" && side === "NO") ||
             (study.stableSide === "below" && side === "YES"));

          let score = 0;
          if (strikeBreakForUs)   score += 2;
          if (strikeBreakAgainst) score -= 2;
          if (sideStableForUs)    score += 2;
          if (sideStableAgainst)  score -= 2;
          if (study.chartAligns)  score += 1;
          if (study.chartOpposes) score -= 1;
          if (study.taAligns)     score += 1;
          if (study.taOpposes)    score -= 1;
          if (study.safeDist)     score += 1;
          if (study.momOk)        score += 1; else score -= 1;

          // Choppiness overrides (strike-relative)
          const heavyChop = study.crossCount >= 2 || study.straddleCount >= 2;
          const choppyRegime = heavyChop || (study.recentChop && study.nearStrike);
          const noConsensus = !study.chartAligns && !study.taAligns && !study.safeDist;

          // ── OPTION 2: Study vs Model independent-direction disagreement veto ──
          // Study direction is computed from strike-relative evidence
          // (trendline breakout, side-stability, chart verdict, TA v2) — fully
          // independent of the model's physics/edge output. If both systems
          // hold a strong opinion and DISAGREE, historical WR is 33% (5/15
          // over 14d). Skip the window entirely — never override the model side.
          const studyDirVotes =
            (study.breakoutSide === "up" ? 2 : 0) +
            (study.breakoutSide === "down" ? -2 : 0) +
            (study.sideStable && study.stableSide === "above" ? 2 : 0) +
            (study.sideStable && study.stableSide === "below" ? -2 : 0) +
            (cvDir === "YES" && cvConf >= 0.6 ? 1 : 0) +
            (cvDir === "NO"  && cvConf >= 0.6 ? -1 : 0) +
            (study.taScoreVal >= 25 ? 1 : 0) +
            (study.taScoreVal <= -25 ? -1 : 0);
          const studyDir: "UP" | "DOWN" | "NEUTRAL" =
            studyDirVotes >= 2 ? "UP" : studyDirVotes <= -2 ? "DOWN" : "NEUTRAL";
          const modelDir: "UP" | "DOWN" | "NEUTRAL" =
            p >= 0.60 ? "UP" : p <= 0.40 ? "DOWN" : "NEUTRAL";
          const modelSideDir: "UP" | "DOWN" = side === "YES" ? "UP" : "DOWN";
          const studyModelDisagree =
            studyDir !== "NEUTRAL" && modelDir !== "NEUTRAL" && studyDir !== modelSideDir;

          if (studyModelDisagree) {
            strikeVerdict = "CHOPPY";
            strikeVerdictReason = `study_model_disagree — study leans ${studyDir} (votes ${studyDirVotes}), model leans ${modelSideDir} (p=${(p * 100).toFixed(0)}%). Backtest WR 33% on disagreement — skip`;
          } else if (choppyRegime && !strikeBreakForUs) {
            strikeVerdict = "CHOPPY";
            strikeVerdictReason = heavyChop
              ? `${study.crossCount} strike-cross${study.crossCount === 1 ? "" : "es"} + ${study.straddleCount} straddle candle${study.straddleCount === 1 ? "" : "s"} during study → chop regime`
              : `chop history + near strike (σ ${sigDist.toFixed(2)}) + no directional break`;
          } else if (score <= -2) {
            strikeVerdict = "CHOPPY";
            strikeVerdictReason = `study score ${score} — signals oppose ${side}`;
          } else if (study.nearStrike && noConsensus) {
            strikeVerdict = "CHOPPY";
            strikeVerdictReason = `near strike (σ ${sigDist.toFixed(2)}) with no chart/TA/distance confirmation`;
          } else if (score >= 4) {
            strikeVerdict = "SOLID";
            const highlights: string[] = [];
            if (strikeBreakForUs)  highlights.push(`trendline break for ${side}`);
            if (sideStableForUs)   highlights.push(`spot held ${study.stableSide} strike`);
            if (study.safeDist)    highlights.push(`σ ${sigDist.toFixed(2)}`);
            if (study.chartAligns) highlights.push(`chart ${(cvConf * 100).toFixed(0)}%`);
            if (study.taAligns)    highlights.push(`TA ${study.taScoreVal.toFixed(0)}`);
            strikeVerdictReason = `${side} confirmed (score ${score}): ${highlights.join(" + ")}`;
          } else {
            strikeVerdict = "WEAK";
            strikeVerdictReason = `${side} with mixed evidence (score ${score}, σ ${sigDist.toFixed(2)}, chart ${cvDir} ${(cvConf * 100).toFixed(0)}%, TA ${study.taScoreVal.toFixed(0)})`;
          }

          if (strikeVerdict === "CHOPPY") {
            entryGate = {
              ...entryGate,
              action: "PASS",
              reason: `strike_choppy — ${strikeVerdictReason}`,
              allReasons: [...entryGate.allReasons, `strike_choppy (${strikeVerdictReason})`],
            };
          }
        }

        const studyFindings = study.findings;



        // Sync legacy gateAction/gateReason with the final entryGate so
        // every downstream consumer (UI badge, auto-trade) sees the same call.
        const finalGateAction: "BET" | "PASS" = entryGate.action === "BET" ? "BET" : "PASS";
        const finalGateReason = entryGate.reason || gateReason;





        // Fire-and-forget log; never throws, idempotent by 60s bucket.
        void logBtcGateDecision({
          decision: entryGate,
          sourcePath: "live_market",
          ticker: m.ticker,
          eventId: e.event_ticker ?? null,
          closeTime,
          secondsToClose,
          modelProb: p,
          yesBid: Number(m.yes_bid_dollars ?? 0) || null,
          yesAsk: yesAskDollars || null,
          noBid: Number(m.no_bid_dollars ?? 0) || null,
          noAsk: noAskDollars || null,
          calibratedEdgeUpstream: edgePts / 100,
          config: btcGateCfg,
        });

        markets.push({
          ticker: m.ticker,
          eventTicker: e.event_ticker,
          title: e.title ?? m.title ?? "BTC 15m",
          subTitle: e.sub_title ?? "",
          yesSubTitle: m.yes_sub_title ?? "",
          strike, yesPrice,
          yesBid: Number(m.yes_bid_dollars ?? 0),
          yesAsk: Number(m.yes_ask_dollars ?? 0),
          noBid: Number(m.no_bid_dollars ?? 0),
          noAsk: Number(m.no_ask_dollars ?? 0),
          openInterest: Number(m.open_interest_fp ?? m.open_interest ?? 0),
          volume: Number(m.volume_fp ?? m.volume ?? 0),
          volume24h: Number(m.volume_24h_fp ?? m.volume_24h ?? 0),
          openTime, closeTime,
          spot, windowOpenPrice: windowOpen, realizedMoveBps,
          modelYesProb: p,
          modelBaseProb: pBase,
          microAdjPts: adj.deltaPts,
          optionsImpliedProb: pOpt,
          optionsBlendPts,
          calibAdjPts: cal.deltaPts,
          calibBucket: cal.bucket,
          calibActive: cal.active,
          modelSource: source,
          edgePts, side, edgeAbs,
          kellyFraction: kelly,
          secondsToClose,
          sigmaDistance: sigDist,
          sigmaMinEffective: sigmaEff,
          theoryYesProb: pBase,
          physicsProb: pDiffusion,
          independentProb: adj.p,

          requiredEdgePts,
          gateAction: finalGateAction,
          gateReason: finalGateReason,
          sideConf,
          thresholdParts: { base: tBase, calib: tCalib, time: tTime, spread: tSpread, regime: tRegime, whale: tWhale },
          gapAnalysis,
          anchorZ: anchorZLive,
          liveSide,
          liveFlipped: liveSide !== side,
          chartVerdict: cvDir as "YES" | "NO" | "neutral",
          chartStrength: cvConf,
          taScore: taScoreRes?.score ?? 0,
          taReasons: taScoreRes?.reasons ?? [],
          taVwapDistPct: taScoreRes?.vwapDistPct ?? null,
          taTrendAlignScore: taScoreRes?.trendAlignScore ?? 0,
          taRsi1m: taScoreRes?.rsi1m ?? null,
          taRsi5m: taScoreRes?.rsi5m ?? null,
          taMacd5mHist: taScoreRes?.macd5mHist ?? null,
          taBb5mPctB: taScoreRes?.bb5mPctB ?? null,
          taVwapRejUp: taScoreRes?.vwapRejectedAgainstUp ?? false,
          taVwapRejDown: taScoreRes?.vwapRejectedAgainstDown ?? false,
          entryGate,
          studying,
          studyingSecondsLeft,
          strikeVerdict,
          strikeVerdictReason,
          studyFindings,
        });

      }
    }

    markets.sort((a, b) => a.secondsToClose - b.secondsToClose);

    // Track every model call (regardless of user bets) and settle past ones.
    // Best-effort: never throws, never blocks the response. Dynamic import so
    // the server-only module never enters the client graph.
    void (async () => {
      try {
        const { snapshotPrediction, settleDuePredictions } = await import("./cryptoPredictions.server");
        const { buildJumpFeatures } = await import("./cryptoJumpBuilder.server");
        const snapshotTs = new Date();
        // Build jump features once per market (all share same snapshot ts).
        const jumpByTicker = new Map<string, unknown>();
        await Promise.all(
          markets
            .filter(m => m.closeTime && m.secondsToClose > 0)
            .map(async m => {
              try {
                const jf = await buildJumpFeatures({
                  snapshotTs,
                  strike: m.strike,
                  side: m.side,
                  sigmaMinPct: m.sigmaMinEffective ?? 0,
                });
                jumpByTicker.set(m.ticker, jf);
              } catch {
                // ignore; jumpFeatures stays undefined
              }
            }),
        );
        await Promise.all(
          markets
            .filter(m => m.closeTime && m.secondsToClose > 0)
            .map(m => snapshotPrediction({
              ticker: m.ticker,
              eventTicker: m.eventTicker,
              strike: m.strike,
              side: m.side,
              modelProb: m.modelYesProb,
              marketYesPrice: m.yesPrice,
              edgePts: m.edgePts,
              spot: m.spot,
              closeTime: m.closeTime as string,
              secondsToClose: m.secondsToClose,
              sigmaMinEffective: m.sigmaMinEffective,
              theoryYesProb: m.theoryYesProb,
              anchorZ: m.anchorZ,
              liveSide: m.liveSide,
              chartVerdict: m.chartVerdict,
              chartStrength: m.chartStrength,
              taScore: m.taScore,
              taReasons: m.taReasons,
              taVwapDistPct: m.taVwapDistPct,
              taTrendAlignScore: m.taTrendAlignScore,
              taRsi1m: m.taRsi1m,
              taRsi5m: m.taRsi5m,
              taMacd5mHist: m.taMacd5mHist,
              taBb5mPctB: m.taBb5mPctB,
              taVwapRejUp: m.taVwapRejUp,
              taVwapRejDown: m.taVwapRejDown,
              taEngineVersion: TA_ENGINE_VERSION,
              physicsProb: m.physicsProb,
              independentProb: m.independentProb,
              jumpFeatures: jumpByTicker.get(m.ticker),
            })),
        );

        await settleDuePredictions();
      } catch (e) {
        console.warn("prediction tracking failed:", e);
      }
    })();

    // ── SHADOW: MarketIntel telemetry (Phase 1) ─────────────────────────
    // Runs in its OWN IIFE so upstream prediction/settlement failures do not
    // skip it. Fire-and-forget. Never affects the live model, gates, trades,
    // or UI. Every failure is swallowed inside computeAndLogMarketIntel.
    void (async () => {
      try {
        const { computeAndLogMarketIntel } = await import("./marketIntel/computeAndLogMarketIntel.server");
        const snapshotTs = new Date();
        const c1m = recent.map(c => ({ ...c, closed: true }));
        const c5m = candles5m.map(c => ({ ...c, closed: true }));
        const results = await Promise.all(
          markets
            .filter(m => m.closeTime && m.secondsToClose > 0)
            .map(m => computeAndLogMarketIntel({
              userId: null,
              ticker: m.ticker,
              strike: m.strike,
              spot: m.spot,
              closeTime: m.closeTime as string,
              decisionTs: snapshotTs,
              secondsToClose: m.secondsToClose,
              candles1m: c1m,
              candles5m: c5m,
              candles15m: [],
              predictionId: null,
            })),
        );
        // Log a compact roll-up so failures are visible in server logs.
        const inserted = results.filter(r => r.inserted).length;
        const skipped = results.filter(r => r.status.startsWith("skipped")).length;
        const failed = results.filter(r => !r.inserted && !r.status.startsWith("skipped"));
        if (failed.length > 0) {
          console.warn(
            `[marketIntel] shadow log: inserted=${inserted} skipped=${skipped} failed=${failed.length}`,
            failed.slice(0, 3).map(f => ({ status: f.status, reason: f.reason })),
          );
        }
      } catch (e) {
        console.warn("[marketIntel] shadow block crashed:", (e as Error).message);
      }
    })();

    return {
      spot,
      asOf: new Date().toISOString(),
      candles: recent,
      markets,
      modelSource: hasExternal ? "external" : "intra-window-diffusion",
      micro,
      options,
      calibration: calibState ? {
        totalSettled: calibState.totalSettled,
        globalHitRate: calibState.globalHitRate,
        globalBrier: calibState.globalBrier,
        buckets: calibState.buckets.map(b => ({
          bucket: b.bucket, n: b.n, hitRate: b.hitRate, meanProb: b.meanProb,
          brier: b.brier, a: b.a, b: b.b, active: b.active,
        })),
        global: calibState.global,
      } : null,
      regime: regimeState ? {
        regime: regimeState.regime,
        sigmaMult: regimeState.sigmaMult,
        driftBiasPerMin: regimeState.driftBiasPerMin,
        confidence: regimeState.confidence,
        reason: regimeState.reason,
        source: regimeState.source,
        asOf: regimeState.asOf,
      } : null,
    };
}


export const getBtcMarkets = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcMarketsResult> => computeBtcMarkets(),
);

