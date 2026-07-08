// Polymarket 5-min BTC Up/Down odds — additional signal for Kalshi auto-trade.
// Fail-open: any error returns null; callers must treat null as "no signal,
// don't block the trade". 10s in-memory cache avoids hammering the API.
//
// Slug pattern (verified 2026-07-08):
//   https://gamma-api.polymarket.com/events?slug=btc-updown-5m-<unix>
// where <unix> is the market window's start time in whole seconds, aligned
// to 5-minute boundaries (…, :00, :05, :10, …).

export interface PolymarketBtcOdds {
  upProb: number;         // 0..1
  downProb: number;       // 0..1
  slug: string;
  windowStartMs: number;  // ms epoch
  windowEndMs: number;    // ms epoch (windowStart + 300_000)
  bestBid: number;        // dollars 0..1 (Up-share)
  bestAsk: number;        // dollars 0..1 (Up-share)
  fetchedAt: number;      // ms epoch
}

const CACHE_MS = 10_000;
let cache: { at: number; slug: string; data: PolymarketBtcOdds | null } | null = null;

/**
 * Fetch the currently-active Polymarket BTC 5-min Up/Down market. Returns
 * `null` on any failure (network, parse, empty result). Never throws.
 */
export async function getPolymarketBtcUpDown(
  nowMs: number = Date.now(),
): Promise<PolymarketBtcOdds | null> {
  // Round DOWN to nearest 5-min boundary in seconds.
  const winStartSec = Math.floor(nowMs / 1000 / 300) * 300;
  const slug = `btc-updown-5m-${winStartSec}`;

  if (cache && cache.slug === slug && nowMs - cache.at < CACHE_MS) {
    return cache.data;
  }

  const url = `https://gamma-api.polymarket.com/events?slug=${slug}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`http ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (await res.json()) as any[];
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("no event");
    const m = arr[0]?.markets?.[0];
    if (!m) throw new Error("no market");
    const outcomes: string[] = safeParseJsonArray(m.outcomes) ?? ["Up", "Down"];
    const prices: string[] = safeParseJsonArray(m.outcomePrices) ?? [];
    const upIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "up");
    const downIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "down");
    if (upIdx < 0 || downIdx < 0 || prices[upIdx] == null || prices[downIdx] == null) {
      throw new Error("bad prices");
    }
    const upProb = clamp01(Number(prices[upIdx]));
    const downProb = clamp01(Number(prices[downIdx]));
    const data: PolymarketBtcOdds = {
      upProb,
      downProb,
      slug,
      windowStartMs: winStartSec * 1000,
      windowEndMs: (winStartSec + 300) * 1000,
      bestBid: Number(m.bestBid ?? 0),
      bestAsk: Number(m.bestAsk ?? 0),
      fetchedAt: nowMs,
    };
    cache = { at: nowMs, slug, data };
    return data;
  } catch {
    // Cache the null result briefly too — avoids retry storms on outage.
    cache = { at: nowMs, slug, data: null };
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeParseJsonArray(v: any): any[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}
