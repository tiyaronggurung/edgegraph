// Kalshi market sentiment for the current 15-min BTC window.
//
// Reads the at-the-money strike's YES price (already fetched by getBtcMarkets)
// and reports market's implied P(up). ATM YES ≈ market consensus that spot
// finishes ≥ strike-closest-to-spot at close.
//
// "Chop" = market itself can't decide — YES sits between CHOP_LO and CHOP_HI.
// Used as an optional gate to skip low-conviction windows.

export interface KalshiSentiment {
  ready: boolean;
  strike: number | null;
  spot: number | null;
  atmYesPct: number | null;          // 0..100
  bias: "up" | "down" | "flat";
  isChop: boolean;                    // 48 ≤ YES ≤ 52
  strengthLabel: "strong" | "moderate" | "chop";
  reason: string;
}

const CHOP_LO = 48;
const CHOP_HI = 52;

interface MarketLike {
  strike: number;
  yesPrice: number; // 0..1 (dollars), from Kalshi Data API
  spot: number;
  secondsToClose: number;
}

/**
 * Compute market sentiment from the currently open 15-min ladder. Picks the
 * SOONEST-to-close window (the one we'd actually bet on this cycle), then
 * finds the strike closest to spot within that window.
 */
export function computeKalshiSentiment(markets: MarketLike[] | null | undefined): KalshiSentiment {
  const empty: KalshiSentiment = {
    ready: false, strike: null, spot: null, atmYesPct: null,
    bias: "flat", isChop: false, strengthLabel: "chop",
    reason: "no market data",
  };
  if (!markets || markets.length === 0) return empty;

  // Restrict to the soonest window (all markets in that window share secondsToClose).
  const openWindows = markets.filter(m => m.secondsToClose > 0);
  if (openWindows.length === 0) return empty;
  const soonest = Math.min(...openWindows.map(m => m.secondsToClose));
  const current = openWindows.filter(m => Math.abs(m.secondsToClose - soonest) < 30);
  if (!current.length) return empty;

  const spot = current[0].spot;
  if (!spot || !Number.isFinite(spot)) return empty;

  // ATM = strike closest to spot.
  let atm = current[0];
  let bestDist = Math.abs(current[0].strike - spot);
  for (const m of current) {
    const d = Math.abs(m.strike - spot);
    if (d < bestDist) { bestDist = d; atm = m; }
  }
  if (!Number.isFinite(atm.yesPrice) || atm.yesPrice <= 0) return { ...empty, spot, strike: atm.strike, reason: "no ATM quote" };

  const atmYesPct = Math.max(0, Math.min(100, atm.yesPrice * 100));
  const isChop = atmYesPct >= CHOP_LO && atmYesPct <= CHOP_HI;
  const bias: "up" | "down" | "flat" = isChop ? "flat" : atmYesPct > 50 ? "up" : "down";
  const strengthLabel: "strong" | "moderate" | "chop" =
    isChop ? "chop" :
    (atmYesPct >= 60 || atmYesPct <= 40) ? "strong" : "moderate";

  const reason = isChop
    ? `market undecided — ATM YES ${atmYesPct.toFixed(0)}¢ in chop belt ${CHOP_LO}–${CHOP_HI}¢`
    : `ATM $${atm.strike.toFixed(0)} · YES ${atmYesPct.toFixed(0)}¢ ⇒ ${bias === "up" ? "UP-leaning" : "DOWN-leaning"} (${strengthLabel})`;

  return {
    ready: true, strike: atm.strike, spot,
    atmYesPct, bias, isChop, strengthLabel, reason,
  };
}

export const KALSHI_SENTIMENT_CHOP_LO = CHOP_LO;
export const KALSHI_SENTIMENT_CHOP_HI = CHOP_HI;
