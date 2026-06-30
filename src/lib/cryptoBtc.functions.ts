// Kalshi BTC 15-min up/down markets + model prediction.
// Model = lognormal diffusion CONDITIONED on intra-window realized price action.
// Optional override: POST market context to CRYPTO_MODEL_URL and use returned {prob}.
import { createServerFn } from "@tanstack/react-start";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const COINBASE = "https://api.exchange.coinbase.com";

export interface BtcCandle {
  t: number; o: number; h: number; l: number; c: number; v: number;
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
  modelSource: "external" | "intra-window-diffusion";
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
}

async function kalshiFetch(path: string): Promise<any> {
  const res = await fetch(`${KALSHI}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Kalshi ${res.status}`);
  return res.json();
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

        let p = spot > 0 && strike > 0
          ? probAboveCond(spot, strike, sigma, minsRemaining)
          : 0.5;
        let source: BtcMarket["modelSource"] = "intra-window-diffusion";

        const ext = await fetchExternalProb({
          ticker: m.ticker, strike, spot, windowOpen,
          minutesRemaining: minsRemaining, yesPrice,
        });
        if (ext !== null) { p = ext; source = "external"; }

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
          modelSource: source,
          edgePts, side, edgeAbs,
          kellyFraction: kelly,
          secondsToClose,
        });
      }
    }

    markets.sort((a, b) => a.secondsToClose - b.secondsToClose);

    // Track every model call (regardless of user bets) and settle past ones.
    // Best-effort: never throws, never blocks the response.
    void (async () => {
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
    })();

    return {
      spot,
      asOf: new Date().toISOString(),
      candles: recent,
      markets,
      modelSource: hasExternal ? "external" : "intra-window-diffusion",
    };
  },
);
