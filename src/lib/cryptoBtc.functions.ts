// Kalshi BTC 15-min up/down markets + model prediction.
// Model = lognormal diffusion CONDITIONED on intra-window realized price action.
// Optional override: POST market context to CRYPTO_MODEL_URL and use returned {prob}.
import { createServerFn } from "@tanstack/react-start";
import { computeGapAnalysis, computeRequiredEdgePts, evaluateGate } from "./cryptoBtcGate";

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
  // ── PHASE 1 · STEP 5 — Edge gate ─────────────────────────────────────────
  requiredEdgePts: number;   // dynamic threshold edge must clear to BET
  gateAction: "BET" | "PASS";
  gateReason: string;        // human explanation of pass/bet
  thresholdParts: { base: number; calib: number; time: number; spread: number; regime: number; whale: number };
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
}


export interface BtcCalibSummary {
  totalSettled: number;
  globalHitRate: number;
  globalBrier: number;
  buckets: Array<{ bucket: string; n: number; hitRate: number; meanProb: number; brier: number; a: number; b: number; active: boolean }>;
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
}


const _kalshiCache = new Map<string, { at: number; data: any }>();
const KALSHI_TTL_MS = 8_000;
const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
  const res = await fetch(`${COINBASE}/products/BTC-USD/candles?granularity=60`, {
    headers: { Accept: "application/json", "User-Agent": "edgegraph/1.0" },
  });
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);
  const rows = (await res.json()) as number[][];
  return rows.map(([t, l, h, o, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

// BRTI-style consolidated spot: median of Coinbase, Binance, Kraken mids.
// Closes the basis gap with Kalshi's settlement index.
async function fetchConsolidatedSpot(fallback: number): Promise<number> {
  const sources = await Promise.allSettled([
    fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { headers: { "User-Agent": "edgegraph/1.0" } })
      .then(r => r.json()).then((j: any) => Number(j.price)),
    fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
      .then(r => r.json()).then((j: any) => Number(j.price)),
    fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD")
      .then(r => r.json()).then((j: any) => {
        const k = Object.values(j.result ?? {})[0] as any;
        return Number(k?.c?.[0]);
      }),
  ]);
  const vals = sources
    .map(s => s.status === "fulfilled" ? s.value : NaN)
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!vals.length) return fallback;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
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

function minuteSigma(candles: BtcCandle[]): number {
  if (candles.length < 5) return 0.0008;
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const r = Math.log(candles[i].c / candles[i - 1].c);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (!rets.length) return 0.0008;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.max(1e-6, Math.sqrt(v));
}

// Conditional prob: given spot now after `elapsed` min into the window, what's
// P(spot at close >= strike)? Only the REMAINING minutes diffuse — the realized
// path is already locked in. This is what makes intra-window edge real.
// (b) Empirical 0.6× correction for 1-min close-to-close noise (bid/ask bounce
// inflates the raw stdev vs true settlement-window variance).
const SIGMA_CORRECTION = 0.6;

function probAboveCond(spot: number, strike: number, sigmaMin: number, minutesRemaining: number): number {
  const t = Math.max(1 / 60, minutesRemaining);
  const sigma = sigmaMin * SIGMA_CORRECTION * Math.sqrt(t);
  if (sigma <= 0) return spot >= strike ? 1 : 0;
  const d = (Math.log(strike / spot) + 0.5 * sigma * sigma) / sigma;
  return 1 - normCdf(d);
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



export const getBtcMarkets = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcMarketsResult> => {
    const [evJson, candles] = await Promise.all([
      kalshiFetch(`/events?status=open&with_nested_markets=true&series_ticker=KXBTC15M&limit=50`),
      fetchBtcCandles().catch(() => [] as BtcCandle[]),
    ]);

    const recent = candles.slice(-60);
    const candleSpot = recent.length ? recent[recent.length - 1].c : 0;
    // (a) Consolidated multi-venue spot (Coinbase + Binance + Kraken median).
    const spot = await fetchConsolidatedSpot(candleSpot);
    const sigma = minuteSigma(recent);
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

    for (const e of events) {
      for (const m of e.markets ?? []) {
        if (m.status !== "active") continue;
        const strike = Number(m.floor_strike ?? 0);
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
          ? probAboveCond(spot, strike, sigmaEff, minsRemaining)
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

        // Locked side: first snapshot picks UP/DOWN for the window.
        const lockedPre = lockedSides.get(m.ticker);
        const tentativeSide: "YES" | "NO" = lockedPre ?? ((p - yesPrice) >= 0 ? "YES" : "NO");

        // (c) Asymmetric blend toward market in the final 2 minutes — only when
        // model trails market on the locked side, never when we're MORE confident
        // than Kalshi (we read spot+time live; their book lags).
        if (yesPrice > 0 && yesPrice < 1) p = blendNearExpiry(p, yesPrice, minsRemaining, tentativeSide);

        const rawEdgePts = (p - yesPrice) * 100;
        const side: "YES" | "NO" = tentativeSide;
        // Edge is reported toward the locked side: positive = still favorable,
        // negative = model has since drifted against the original pick.
        const edgePts = side === "YES" ? rawEdgePts : -rawEdgePts;
        const edgeAbs = Math.abs(edgePts);
        const kelly = quarterKelly(p, yesPrice);

        // Time/vol safety margin — how many σ from strike (locked side).
        const sigDist = sigmaDistance(spot, strike, sigmaEff, minsRemaining);

        // ── STEP 5 · Edge gate ────────────────────────────────────────────
        const bucketFit = calibState?.buckets.find(b => b.bucket === cal.bucket);
        const tBase = 3;
        // Worse calibration Brier → require more edge. Brier 0.20 = neutral.
        const tCalib = bucketFit && bucketFit.n >= 30
          ? Math.max(0, Math.min(4, (bucketFit.brier - 0.20) * 30))
          : 0.5; // cold start: small penalty until we have data
        // Time-to-close: MMs sharpest in the final minute.
        const tTime = secondsToClose < 60 ? 2 : secondsToClose < 300 ? 1 : 0;
        // Wide book = stale prices; demand more edge.
        const sp = micro?.bookSpreadBps ?? 0;
        const tSpread = sp > 10 ? 2 : sp > 5 ? 1 : 0;
        // Regime filter: extreme funding or basis squeeze = unstable, require more.
        const fundAbs = Math.abs(micro?.fundingRate ?? 0) / 0.00005; // z-ish
        const basisAbs = Math.abs(micro?.basisBps ?? 0) / 5;
        const tRegime = (fundAbs > 2 || basisAbs > 2) ? 1.5 : 0;
        // Step 6 · Whale-flow regime: strong aligned whale flow LOWERS bar,
        // contradictory whale flow RAISES it. |imbalance| > 0.6 = strong.
        const wImb = micro?.whaleImbalance1m ?? 0;
        const sideSign = side === "YES" ? 1 : -1;
        let tWhale = 0;
        if (Math.abs(wImb) > 0.6 && (micro?.whaleBuyUsd1m ?? 0) + (micro?.whaleSellUsd1m ?? 0) > 500_000) {
          tWhale = Math.sign(wImb) === sideSign ? -1.0 : 1.5;
        }
        const requiredEdgePts = Math.max(1.5, tBase + tCalib + tTime + tSpread + tRegime + tWhale);

        // ── Gap analysis: anchor every verdict in strike↔spot geometry ──
        // Locked side WINS at close iff: YES → finalSpot ≥ strike, NO → finalSpot ≤ strike.
        // "needsToMoveUsd" = signed $ spot must travel from NOW to barely win at close (0 if already winning side).
        const sideWantsAbove = side === "YES";
        const currentlyWinning = sideWantsAbove ? (spot >= strike) : (spot <= strike);
        const needsToMoveUsd = currentlyWinning ? 0 : (sideWantsAbove ? (strike - spot) : (strike - spot));
        // 1σ remaining-window move in $ (sigmaEff is per-minute σ in % terms)
        const expectedMoveUsd = (sigmaEff / 100) * Math.sqrt(Math.max(secondsToClose, 1) / 60) * spot;
        const gapInSigmas = expectedMoveUsd > 0 ? Math.abs(needsToMoveUsd) / expectedMoveUsd : 99;
        const momentumBlend = ((micro?.cvdRatio ?? 0) + (micro?.ofi ?? 0)) / 2;
        const momentumSign: -1 | 0 | 1 = momentumBlend > 0.05 ? 1 : momentumBlend < -0.05 ? -1 : 0;
        // Momentum "helps" the locked side if it pushes spot in the winning direction.
        // YES wants spot up (or at least not down). NO wants spot down.
        const momentumAlignsWithSide = momentumSign === 0
          ? true
          : (sideWantsAbove ? momentumSign > 0 : momentumSign < 0);
        const gapVerdict = currentlyWinning
          ? `spot ${sideWantsAbove ? "above" : "below"} strike by $${Math.abs(spot - strike).toFixed(0)} — ${side} defends · ${expectedMoveUsd.toFixed(0)}$/σ remaining · momentum ${momentumBlend >= 0 ? "+" : ""}${momentumBlend.toFixed(2)} ${momentumAlignsWithSide ? "holds" : "threatens"}`
          : `spot must move ${sideWantsAbove ? "+" : "−"}$${Math.abs(needsToMoveUsd).toFixed(0)} in ${secondsToClose}s (${gapInSigmas.toFixed(2)}σ) · momentum ${momentumBlend >= 0 ? "+" : ""}${momentumBlend.toFixed(2)} ${momentumAlignsWithSide ? "helps" : "fights"} ${side}`;
        const gapAnalysis = {
          gapUsd: spot - strike,
          gapPct: ((spot - strike) / spot) * 100,
          needsToMoveUsd,
          needsDirection: (currentlyWinning ? "hold" : (sideWantsAbove ? "up" : "down")) as "up" | "down" | "hold",
          expectedMoveUsd,
          gapInSigmas: currentlyWinning ? 0 : gapInSigmas,
          momentumSign,
          momentumAlignsWithSide,
          verdict: gapVerdict,
        };

        let gateAction: "BET" | "PASS" = "PASS";
        let gateReason = "";
        // Pin-risk tightens as the clock runs: 0.5σ floor with >3min, 1.0σ inside 3min,
        // 1.5σ inside 90s. Final minute is structurally a coin flip — Kalshi sets ATM
        // strikes at t-15m specifically to maximize this; our edge cannot survive it.
        const pinRiskFloor = secondsToClose <= 90 ? 1.5 : secondsToClose <= 180 ? 1.0 : 0.5;
        if (secondsToClose <= 30) {
          gateReason = "too close to expiry (<30s) — slippage risk";
        } else if (yesPrice <= 0.02 || yesPrice >= 0.98) {
          gateReason = "price pinned (≤2¢ or ≥98¢) — no room for edge";
        } else if (sigDist < pinRiskFloor && secondsToClose > 60) {
          gateReason = `coin-flip zone — strike only ${sigDist.toFixed(2)}σ from spot (floor ${pinRiskFloor.toFixed(1)}σ at ${secondsToClose}s)`;
        } else if (!currentlyWinning && gapInSigmas > 1.0 && !momentumAlignsWithSide) {
          // Spot must traverse >1σ to win AND momentum is pushing the wrong way → structural loss.
          gateReason = `traversal block — ${side} needs ${gapInSigmas.toFixed(2)}σ move but momentum fights`;
        } else if (!currentlyWinning && gapInSigmas > 1.5) {
          // Even with neutral/aligned momentum, >1.5σ of required traversal is a low-probability shot.
          gateReason = `gap too wide — ${side} needs ${gapInSigmas.toFixed(2)}σ traversal in ${secondsToClose}s`;
        } else if (edgeAbs < requiredEdgePts) {
          gateReason = `edge ${edgeAbs.toFixed(1)}pts < required ${requiredEdgePts.toFixed(1)}pts`;
        } else if (kelly <= 0) {
          gateReason = "Kelly fraction ≤ 0";
        } else {
          gateAction = "BET";
          gateReason = `edge ${edgeAbs.toFixed(1)}pts ≥ required ${requiredEdgePts.toFixed(1)}pts · safety ${sigDist.toFixed(2)}σ · ${gapVerdict}`;
        }

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
          requiredEdgePts,
          gateAction,
          gateReason,
          thresholdParts: { base: tBase, calib: tCalib, time: tTime, spread: tSpread, regime: tRegime, whale: tWhale },
          gapAnalysis,
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
            })),
        );
        await settleDuePredictions();
      } catch (e) {
        console.warn("prediction tracking failed:", e);
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
      } : null,
    };
  },
);
