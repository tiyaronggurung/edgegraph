// Lightweight current-window KXBTC15M strike lookup for the live price card.
// Unlike the full market-flow request, this stops after the events response so
// the display odds are never held up by paginated trade-history downloads.
import { createServerFn } from "@tanstack/react-start";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";

export interface KalshiCurrentStrike {
  ok: boolean;
  ticker: string | null;
  strike: number | null;
  secondsToClose: number | null;
  error: string | null;
}

let cache: { at: number; value: KalshiCurrentStrike } | null = null;
let inFlight: Promise<KalshiCurrentStrike> | null = null;
// The strike does not change inside a 15-minute market. A longer shared cache
// prevents several mounted panels from repeatedly hitting the same Kalshi
// events endpoint, while the remaining-time check below still rolls promptly.
const CACHE_MS = 5_000;
const FETCH_TIMEOUT_MS = 2_500;

function cachedValue(now: number): KalshiCurrentStrike | null {
  if (cache == null || now - cache.at >= CACHE_MS) return null;
  const elapsed = Math.floor((now - cache.at) / 1000);
  const remaining = Math.max(0, (cache.value.secondsToClose ?? 0) - elapsed);
  return remaining > 0 ? { ...cache.value, secondsToClose: remaining } : null;
}

async function fetchCurrentStrike(): Promise<KalshiCurrentStrike> {
  const empty: KalshiCurrentStrike = {
    ok: false,
    ticker: null,
    strike: null,
    secondsToClose: null,
    error: null,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(
      `${KALSHI}/events?status=open&with_nested_markets=true&series_ticker=KXBTC15M&limit=25`,
      { headers: { accept: "application/json" }, signal: controller.signal },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) return { ...empty, error: `kalshi ${res.status}` };

    const json = (await res.json()) as {
      events?: Array<{
        markets?: Array<{
          ticker: string;
          close_time: string;
          floor_strike?: number;
          status?: string;
        }>;
      }>;
    };

    const now = Date.now();
    let best: { ticker: string; strike: number; secondsToClose: number } | null = null;
    for (const event of json.events ?? []) {
      for (const market of event.markets ?? []) {
        // Around the exact 15-minute rollover Kalshi can expose the new open
        // market a few seconds before changing its nested status to "active".
        // close_time is the reliable boundary here; accepting that upcoming row
        // prevents a blank strike while the status label catches up.
        if (market.status === "closed" || market.status === "settled") continue;
        const secondsToClose = Math.floor((Date.parse(market.close_time) - now) / 1000);
        const strike = Number(market.floor_strike);
        if (secondsToClose <= 0 || !Number.isFinite(strike)) continue;
        if (best == null || secondsToClose < best.secondsToClose) {
          best = { ticker: market.ticker, strike, secondsToClose };
        }
      }
    }

    return best == null
      ? { ...empty, error: "no open market" }
      : { ok: true, ...best, error: null };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : "strike unavailable" };
  }
}

export async function loadKalshiCurrentStrike(): Promise<KalshiCurrentStrike> {
    const now = Date.now();
    const fresh = cachedValue(now);
    if (fresh != null) return fresh;
    if (inFlight != null) return inFlight;
    inFlight = fetchCurrentStrike()
      .then((value) => {
        if (value.ok) {
          cache = { at: Date.now(), value };
          return value;
        }
        // Keep a still-open last-known strike through a brief 429/outage. Never
        // carry it across the market close into the next 15-minute window.
        if (cache != null) {
          const elapsed = Math.floor((Date.now() - cache.at) / 1000);
          const remaining = Math.max(0, (cache.value.secondsToClose ?? 0) - elapsed);
          if (remaining > 0) return { ...cache.value, secondsToClose: remaining };
        }
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
}

export const getKalshiCurrentStrike = createServerFn({ method: "GET" }).handler(
  async (): Promise<KalshiCurrentStrike> => loadKalshiCurrentStrike(),
);