// Kalshi BTC 15-min up/down markets + lightweight model prediction.
// Public Kalshi + Coinbase Exchange feeds, no auth required.
import { createServerFn } from "@tanstack/react-start";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const COINBASE = "https://api.exchange.coinbase.com";

export interface BtcCandle {
  t: number; // unix seconds (bar start)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BtcMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  subTitle: string;
  yesSubTitle: string;
  strike: number;            // floor_strike (target price)
  yesPrice: number;          // 0..1 (last)
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  openInterest: number;
  volume: number;
  volume24h: number;
  openTime: string | null;   // ISO — strike window start
  closeTime: string | null;  // ISO — resolution
  // Model output
  spot: number;              // BTC spot at evaluation
  modelYesProb: number;      // 0..1 — P(BTC avg ≥ strike at close)
  edgePts: number;           // (modelYesProb*100) - (yesPrice*100). Positive => bet YES, negative => bet NO.
  side: "YES" | "NO";        // which side has edge
  edgeAbs: number;           // |edgePts|
  kellyFraction: number;     // quarter-Kelly bankroll fraction
  secondsToClose: number;
}

interface BtcMarketsResult {
  spot: number;
  asOf: string;
  candles: BtcCandle[];      // last ~60 1-min bars, oldest -> newest
  markets: BtcMarket[];
}

async function kalshiFetch(path: string): Promise<any> {
  const res = await fetch(`${KALSHI}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Kalshi ${res.status}`);
  return res.json();
}

async function fetchBtcCandles(): Promise<BtcCandle[]> {
  // Granularity 60s; Coinbase returns newest first. Reverse to oldest->newest.
  const res = await fetch(`${COINBASE}/products/BTC-USD/candles?granularity=60`, {
    headers: { Accept: "application/json", "User-Agent": "edgegraph/1.0" },
  });
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);
  const rows = (await res.json()) as number[][];
  return rows
    .map(([t, l, h, o, c, v]) => ({ t, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}

// Normal CDF via erf approximation.
function normCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

// Per-minute log-return std-dev from candle closes.
function minuteSigma(candles: BtcCandle[]): number {
  if (candles.length < 5) return 0.0008; // ~8bps fallback
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

// Probability that BTC spot at close (≈ avg of last minute) ≥ strike.
// Lognormal diffusion from current spot over t minutes, sigma_min per minute.
function probAbove(spot: number, strike: number, sigmaMin: number, minutesToClose: number): number {
  const t = Math.max(1 / 60, minutesToClose); // floor at 1 second
  const sigma = sigmaMin * Math.sqrt(t);
  if (sigma <= 0) return spot >= strike ? 1 : 0;
  // ln(S_T/S_0) ~ N(-sigma^2/2, sigma^2). P(S_T >= K) = 1 - N(d), d = (ln(K/S) + sigma^2/2)/sigma
  const d = (Math.log(strike / spot) + 0.5 * sigma * sigma) / sigma;
  return 1 - normCdf(d);
}

function quarterKelly(p: number, priceYes: number): number {
  // Bet YES if p > priceYes; b = (1-price)/price ; f* = (bp - q)/b
  // Bet NO otherwise; price_no = 1 - price_yes; q = 1 - p
  const betYes = p > priceYes;
  const price = betYes ? priceYes : 1 - priceYes;
  const prob = betYes ? p : 1 - p;
  if (price <= 0.01 || price >= 0.99) return 0;
  const b = (1 - price) / price;
  const f = (b * prob - (1 - prob)) / b;
  return Math.max(0, Math.min(0.05, f * 0.25)); // quarter-Kelly, cap 5%
}

export const getBtcMarkets = createServerFn({ method: "GET" }).handler(
  async (): Promise<BtcMarketsResult> => {
    const [evJson, candles] = await Promise.all([
      kalshiFetch(`/events?status=open&with_nested_markets=true&series_ticker=KXBTC15M&limit=50`),
      fetchBtcCandles().catch(() => [] as BtcCandle[]),
    ]);

    const recent = candles.slice(-60);
    const spot = recent.length ? recent[recent.length - 1].c : 0;
    const sigma = minuteSigma(recent);
    const now = Date.now();

    const events = (evJson.events ?? []) as any[];
    const markets: BtcMarket[] = [];

    for (const e of events) {
      for (const m of e.markets ?? []) {
        if (m.status !== "active") continue;
        const strike = Number(m.floor_strike ?? 0);
        const yesPrice = Number(m.last_price_dollars ?? m.yes_bid_dollars ?? 0);
        const closeTime = m.close_time ?? m.expected_expiration_time ?? null;
        const closeMs = closeTime ? new Date(closeTime).getTime() : now + 15 * 60_000;
        const minsToClose = Math.max(0, (closeMs - now) / 60_000);
        const secondsToClose = Math.max(0, Math.round((closeMs - now) / 1000));

        const p = spot > 0 && strike > 0
          ? probAbove(spot, strike, sigma, minsToClose)
          : 0.5;

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
          strike,
          yesPrice,
          yesBid: Number(m.yes_bid_dollars ?? 0),
          yesAsk: Number(m.yes_ask_dollars ?? 0),
          noBid: Number(m.no_bid_dollars ?? 0),
          noAsk: Number(m.no_ask_dollars ?? 0),
          openInterest: Number(m.open_interest_fp ?? m.open_interest ?? 0),
          volume: Number(m.volume_fp ?? m.volume ?? 0),
          volume24h: Number(m.volume_24h_fp ?? m.volume_24h ?? 0),
          openTime: m.open_time ?? null,
          closeTime,
          spot,
          modelYesProb: p,
          edgePts,
          side,
          edgeAbs,
          kellyFraction: kelly,
          secondsToClose,
        });
      }
    }

    // Soonest-closing first.
    markets.sort((a, b) => a.secondsToClose - b.secondsToClose);

    return {
      spot,
      asOf: new Date().toISOString(),
      candles: recent,
      markets,
    };
  },
);
