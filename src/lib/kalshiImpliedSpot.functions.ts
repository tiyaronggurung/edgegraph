// Kalshi market-implied BTC "spot" — derived from the soonest open KXBTC15M
// market's YES midpoint and strike using a normal approximation:
//
//   z            = Φ⁻¹(yesMid)         (0.5 → 0)
//   σ_T          = σ_annual · √(T/yr)
//   impliedSpot  = strike / exp(z · σ_T)
//
// This is what Kalshi traders are collectively pricing BTC at right now,
// expressed as a spot number, so we can compare it directly to our
// Coinbase/Binance/Kraken composite on the trendline chart.
//
// Read-only, unauthenticated — used purely for a header display chip.

import { createServerFn } from "@tanstack/react-start";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
// BTC ~60% annualized vol is close enough for a 15-min inversion; the
// implied spot moves ~$5 per full σ change, so precision here is fine.
const SIGMA_ANNUAL = 0.60;
const YEAR_SEC = 365 * 24 * 3600;

// Beasley-Springer-Moro rational approximation of Φ⁻¹, plenty accurate for
// yesMid ∈ [0.005, 0.995] which is the tradable Kalshi range.
function normInv(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

export interface KalshiImpliedSpot {
  ok: boolean;
  ticker: string | null;
  strike: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  yesMid: number | null;
  secondsToClose: number | null;
  impliedSpot: number | null;
  // ---- volume / flow (added for side-flow study) ----
  volume: number | null;                // cumulative contracts traded
  openInterest: number | null;          // current open contracts
  lastPriceCents: number | null;        // last-trade price in cents (YES side)
  yesVol60s: number | null;             // YES taker contracts, last 60s
  noVol60s: number | null;              // NO taker contracts, last 60s
  tradeCount60s: number | null;         // #trades in last 60s
  error: string | null;
}


export const getKalshiImpliedSpot = createServerFn({ method: "GET" }).handler(
  async (): Promise<KalshiImpliedSpot> => {
    const empty: KalshiImpliedSpot = {
      ok: false, ticker: null, strike: null, yesBid: null, yesAsk: null,
      yesMid: null, secondsToClose: null, impliedSpot: null,
      volume: null, openInterest: null, lastPriceCents: null,
      yesVol60s: null, noVol60s: null, tradeCount60s: null,
      error: null,
    };
    try {
      const res = await fetch(
        `${KALSHI}/events?status=open&with_nested_markets=true&series_ticker=KXBTC15M&limit=25`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) return { ...empty, error: `kalshi ${res.status}` };
      const json = await res.json() as {
        events?: Array<{
          markets?: Array<{
            ticker: string;
            close_time: string;
            floor_strike?: number;
            yes_bid_dollars?: string;
            yes_ask_dollars?: string;
            status?: string;
            volume?: number;
            volume_fp?: string;
            open_interest?: number;
            open_interest_fp?: string;
            last_price?: number;
            last_price_dollars?: string;
          }>;
        }>;
      };

      const now = Date.now();
      let best: {
        ticker: string; strike: number; bid: number; ask: number; stc: number;
        volume: number | null; openInterest: number | null; lastPrice: number | null;
      } | null = null;
      for (const ev of json.events ?? []) {
        for (const m of ev.markets ?? []) {
          if (m.status && m.status !== "active") continue;
          const close = new Date(m.close_time).getTime();
          const stc = Math.floor((close - now) / 1000);
          if (stc <= 0) continue;
          const bid = m.yes_bid_dollars != null ? Number(m.yes_bid_dollars) : NaN;
          const ask = m.yes_ask_dollars != null ? Number(m.yes_ask_dollars) : NaN;
          const strike = m.floor_strike != null ? Number(m.floor_strike) : NaN;
          if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(strike)) continue;
          if (!best || stc < best.stc) {
            best = {
              ticker: m.ticker, strike, bid, ask, stc,
              volume: m.volume != null ? Number(m.volume) : null,
              openInterest: m.open_interest != null ? Number(m.open_interest) : null,
              lastPrice: m.last_price != null ? Number(m.last_price) : null,
            };
          }
        }
      }
      if (!best) return { ...empty, error: "no open market" };

      const yesMid = (best.bid + best.ask) / 2;
      const clamped = Math.min(0.995, Math.max(0.005, yesMid));
      const T = Math.max(30, best.stc) / YEAR_SEC;
      const sigmaT = SIGMA_ANNUAL * Math.sqrt(T);
      const z = normInv(clamped);
      const implied = sigmaT > 0 ? best.strike / Math.exp(z * sigmaT) : best.strike;

      // Parallel: fetch last ~60s of trades for per-side flow. Public endpoint,
      // no auth. Cheap best-effort — nulls if it fails so recorder still runs.
      let yesVol60s: number | null = null;
      let noVol60s: number | null = null;
      let tradeCount60s: number | null = null;
      try {
        const minTs = Math.floor(Date.now() / 1000) - 60;
        const tRes = await fetch(
          `${KALSHI}/markets/trades?ticker=${encodeURIComponent(best.ticker)}&limit=200&min_ts=${minTs}`,
          { headers: { accept: "application/json" } },
        );
        if (tRes.ok) {
          const tJson = await tRes.json() as {
            trades?: Array<{ taker_side?: string; count?: number; created_time?: string }>;
          };
          let yes = 0, no = 0, cnt = 0;
          const cutoff = Date.now() - 60_000;
          for (const t of tJson.trades ?? []) {
            const ts = t.created_time ? new Date(t.created_time).getTime() : NaN;
            if (Number.isFinite(ts) && ts < cutoff) continue;
            const c = Number(t.count ?? 0);
            if (!Number.isFinite(c) || c <= 0) continue;
            cnt += 1;
            const side = String(t.taker_side ?? "").toLowerCase();
            if (side === "yes") yes += c;
            else if (side === "no") no += c;
          }
          yesVol60s = yes; noVol60s = no; tradeCount60s = cnt;
        }
      } catch { /* best-effort */ }

      return {
        ok: true,
        ticker: best.ticker,
        strike: best.strike,
        yesBid: best.bid,
        yesAsk: best.ask,
        yesMid,
        secondsToClose: best.stc,
        impliedSpot: Number(implied.toFixed(2)),
        volume: best.volume,
        openInterest: best.openInterest,
        lastPriceCents: best.lastPrice != null ? Math.round(best.lastPrice) : null,
        yesVol60s,
        noVol60s,
        tradeCount60s,
        error: null,
      };
    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
  },
);

