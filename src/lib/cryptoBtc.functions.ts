// Kalshi BTC 15-min up/down markets + model prediction.
// Model = lognormal diffusion CONDITIONED on intra-window realized price action.
// Optional override: POST market context to CRYPTO_MODEL_URL and use returned {prob}.
import { createServerFn } from "@tanstack/react-start";

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
  edgePts: number;
  side: "YES" | "NO";
  edgeAbs: number;
  kellyFraction: number;     // quarter-Kelly bankroll fraction (display only)
  secondsToClose: number;
}


interface BtcMarketsResult {
  spot: number;
  asOf: string;
  candles: BtcCandle[];
  markets: BtcMarket[];
  modelSource: "external" | "intra-window-diffusion";
  micro: BtcMicro | null;
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

// (c) Pull model toward market when very little time remains — the residual
// diffusion variance is mostly noise vs the already-locked path.
function blendNearExpiry(modelP: number, marketP: number, minsRemaining: number): number {
  if (minsRemaining >= 2) return modelP;
  // weight on market grows from 0 at 2min to 0.85 at 0min
  const w = Math.min(0.85, (2 - minsRemaining) / 2 * 0.85);
  return modelP * (1 - w) + marketP * w;
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

// ── PHASE 1 · STEP 1 ────────────────────────────────────────────────────────
// Microstructure signals from Binance USDT-perp:
//  · funding rate  — directional crowding tax
//  · OI 5-min delta — fresh leverage building or unwinding
//  · spot–perp basis — pressure / liquidation proxy
// Cached 20s to stay friendly with public endpoints.
let _microCache: { at: number; data: BtcMicro | null } | null = null;
const MICRO_TTL_MS = 20_000;

async function fetchBinanceMicro(spot: number): Promise<BtcMicro | null> {
  if (_microCache && Date.now() - _microCache.at < MICRO_TTL_MS) return _microCache.data;
  try {
    const [fundingRes, oiRes, oiHistRes, perpRes] = await Promise.all([
      fetch("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
      fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"),
      fetch("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=2"),
      fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT"),
    ]);
    if (!fundingRes.ok || !oiRes.ok || !perpRes.ok) throw new Error("micro http");
    const funding: any = await fundingRes.json();
    const oi: any = await oiRes.json();
    const perp: any = await perpRes.json();
    const hist: any[] = oiHistRes.ok ? await oiHistRes.json() : [];

    const fundingRate = Number(funding.lastFundingRate ?? 0); // per 8h
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

    const data: BtcMicro = {
      fundingRate,
      fundingAnnualBps: fundingRate * 3 * 365 * 10000,
      oiNotional,
      oiDelta5mPct,
      basisBps,
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
// Conservative, hand-tuned coefficients. Bounded at ±4 points so a single
// noisy signal cannot flip a call by itself.
function microAdjustment(p: number, m: BtcMicro | null, secondsToClose: number): { p: number; deltaPts: number } {
  if (!m || secondsToClose <= 30 || p <= 0 || p >= 1) return { p, deltaPts: 0 };

  // z-style: positive = bullish for next 15m, negative = bearish.
  // Funding > +0.01% / 8h = crowded longs (bearish lean — paying to be long).
  const fundingZ = -Math.max(-3, Math.min(3, m.fundingRate / 0.00005));   // ±3 around ±2.5bps/8h
  // OI rising while basis positive = fresh longs piling in (bullish short term, can revert).
  // OI rising while basis negative = fresh shorts (bearish short term).
  const oiZ = Math.max(-2, Math.min(2, m.oiDelta5mPct / 0.5)) * Math.sign(m.basisBps || 1);
  // Basis blowout: |basis| > 5bps suggests imbalance; sign = direction of pressure.
  const basisZ = Math.max(-2, Math.min(2, m.basisBps / 5));

  const score = 0.35 * fundingZ + 0.25 * oiZ + 0.40 * basisZ; // ~±2.5 typical
  // Convert score → logit shift, scale down hard, cap at ±0.18 logit (≈ ±4 prob points near 0.5).
  const logitShift = Math.max(-0.18, Math.min(0.18, score * 0.05));
  const eps = 1e-6;
  const logit = Math.log(Math.max(eps, p) / Math.max(eps, 1 - p));
  const pNew = 1 / (1 + Math.exp(-(logit + logitShift)));
  return { p: pNew, deltaPts: (pNew - p) * 100 };
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

    // (d) Microstructure features — funding, OI delta, spot–perp basis.
    const micro = await fetchBinanceMicro(spot);

    const events = (evJson.events ?? []) as any[];
    const markets: BtcMarket[] = [];

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

        let pBase = spot > 0 && strike > 0
          ? probAboveCond(spot, strike, sigma, minsRemaining)
          : 0.5;
        let source: BtcMarket["modelSource"] = "intra-window-diffusion";

        const ext = await fetchExternalProb({
          ticker: m.ticker, strike, spot, windowOpen,
          minutesRemaining: minsRemaining, yesPrice,
        });
        if (ext !== null) { pBase = ext; source = "external"; }

        // (d) Apply microstructure logistic adjustment on top of base prob.
        const adj = microAdjustment(pBase, micro, secondsToClose);
        let p = adj.p;

        // (c) Shrink toward market in the final 2 minutes.
        if (yesPrice > 0 && yesPrice < 1) p = blendNearExpiry(p, yesPrice, minsRemaining);

        const edgePts = (p - yesPrice) * 100;
        const side: "YES" | "NO" = edgePts >= 0 ? "YES" : "NO";
        const edgeAbs = Math.abs(edgePts);
        const kelly = quarterKelly(p, yesPrice);

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
          modelSource: source,
          edgePts, side, edgeAbs,
          kellyFraction: kelly,
          secondsToClose,
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
    };
  },
);
