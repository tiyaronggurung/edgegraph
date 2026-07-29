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
  // ---- cumulative flow for the whole current 15m window (since :00/:15/:30/:45) ----
  yesVolWindow: number | null;          // YES taker contracts, window-to-date
  noVolWindow: number | null;           // NO taker contracts, window-to-date
  tradeCountWindow: number | null;      // #trades, window-to-date
  /** Per-minute ladder, minute 0 = window open. Only minutes with trades. */
  flowLadder: Array<{ m: number; yes: number; no: number; trades: number }> | null;
  error: string | null;
}



export const getKalshiImpliedSpot = createServerFn({ method: "GET" }).handler(
  async (): Promise<KalshiImpliedSpot> => {
    const num = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const empty: KalshiImpliedSpot = {
      ok: false, ticker: null, strike: null, yesBid: null, yesAsk: null,
      yesMid: null, secondsToClose: null, impliedSpot: null,
      volume: null, openInterest: null, lastPriceCents: null,
      yesVol60s: null, noVol60s: null, tradeCount60s: null,
      yesVolWindow: null, noVolWindow: null, tradeCountWindow: null, flowLadder: null,
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
              // Kalshi returns these as *_fp decimal strings; the legacy
              // integer fields are absent, which is why volume logged as 0.
              volume: num(m.volume_fp ?? m.volume),
              openInterest: num(m.open_interest_fp ?? m.open_interest),
              lastPrice: m.last_price_dollars != null
                ? num(m.last_price_dollars) != null ? Number(m.last_price_dollars) * 100 : null
                : num(m.last_price),
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

      // Per-side taker flow. One paginated pull covering the ENTIRE current
      // 15m window (since :00/:15/:30/:45) — the rolling 60s figure is derived
      // from the same trade list, so the strip's 60s number and the window
      // total can never disagree. Public endpoint, no auth, best-effort.
      let yesVol60s: number | null = null;
      let noVol60s: number | null = null;
      let tradeCount60s: number | null = null;
      let yesVolWindow: number | null = null;
      let noVolWindow: number | null = null;
      let tradeCountWindow: number | null = null;
      let flowLadder: Array<{ m: number; yes: number; no: number; trades: number }> | null = null;
      try {
        const nowMs = Date.now();
        const winStartMs = Math.floor(nowMs / 900_000) * 900_000;
        const minTs = Math.floor(winStartMs / 1000);
        const cutoff60 = nowMs - 60_000;

        type Trade = { taker_side?: string; count?: number; count_fp?: string; created_time?: string };
        const trades: Trade[] = [];
        let cursor: string | undefined;
        // 15m of BTC 15m-market trades fits comfortably; cap pages to stay cheap.
        for (let page = 0; page < 5; page++) {
          const url =
            `${KALSHI}/markets/trades?ticker=${encodeURIComponent(best.ticker)}` +
            `&limit=1000&min_ts=${minTs}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const tRes = await fetch(url, { headers: { accept: "application/json" } });
          if (!tRes.ok) break;
          const tJson = await tRes.json() as { trades?: Trade[]; cursor?: string };
          const batch = tJson.trades ?? [];
          trades.push(...batch);
          cursor = tJson.cursor || undefined;
          if (!cursor || batch.length === 0) break;
        }

        let y60 = 0, n60 = 0, c60 = 0;
        let yW = 0, nW = 0, cW = 0;
        const ladder = new Map<number, { yes: number; no: number; trades: number }>();
        for (const t of trades) {
          const ts = t.created_time ? new Date(t.created_time).getTime() : NaN;
          if (!Number.isFinite(ts) || ts < winStartMs) continue;
          const c = num(t.count_fp ?? t.count) ?? 0;
          if (!Number.isFinite(c) || c <= 0) continue;
          const isYes = String(t.taker_side ?? "").toLowerCase() === "yes";
          const isNo = String(t.taker_side ?? "").toLowerCase() === "no";
          if (!isYes && !isNo) continue;

          cW += 1;
          if (isYes) yW += c; else nW += c;

          const m = Math.min(14, Math.max(0, Math.floor((ts - winStartMs) / 60_000)));
          const b = ladder.get(m) ?? { yes: 0, no: 0, trades: 0 };
          if (isYes) b.yes += c; else b.no += c;
          b.trades += 1;
          ladder.set(m, b);

          if (ts >= cutoff60) {
            c60 += 1;
            if (isYes) y60 += c; else n60 += c;
          }
        }
        yesVol60s = y60; noVol60s = n60; tradeCount60s = c60;
        yesVolWindow = yW; noVolWindow = nW; tradeCountWindow = cW;
        flowLadder = [...ladder.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([m, v]) => ({ m, yes: Math.round(v.yes), no: Math.round(v.no), trades: v.trades }));
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
        volume: best.volume != null ? Math.round(best.volume) : null,
        openInterest: best.openInterest != null ? Math.round(best.openInterest) : null,
        lastPriceCents: best.lastPrice != null ? Math.round(best.lastPrice) : null,
        yesVol60s: yesVol60s != null ? Math.round(yesVol60s) : null,
        noVol60s: noVol60s != null ? Math.round(noVol60s) : null,
        tradeCount60s,
        yesVolWindow: yesVolWindow != null ? Math.round(yesVolWindow) : null,
        noVolWindow: noVolWindow != null ? Math.round(noVolWindow) : null,
        tradeCountWindow,
        flowLadder,
        error: null,
      };

    } catch (e) {
      return { ...empty, error: (e as Error).message };
    }
  },
);

