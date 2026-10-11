// Live Kalshi ask from the /orderbook endpoint. The /markets/{ticker} endpoint
// is CDN-cached ~10s; the orderbook is not. Returns null on any failure so
// callers can fall back to their existing quote path.
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";

type Level = [string, string];

function bestBidCents(levels: Level[] | undefined): number | null {
  if (!levels?.length) return null;
  let best = -1;
  for (const [p, q] of levels) {
    const price = Number(p);
    if (Number(q) > 0 && Number.isFinite(price) && price > best) best = price;
  }
  return best < 0 ? null : Math.round(best * 100);
}

export async function fetchLiveAskCents(ticker: string, side: "YES" | "NO"): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`${KALSHI}/markets/${encodeURIComponent(ticker)}/orderbook?depth=5`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const j = (await res.json()) as {
      orderbook_fp?: { yes_dollars?: Level[]; no_dollars?: Level[] };
    };
    const ob = j.orderbook_fp;
    if (!ob) return null;
    // Buying YES lifts the best NO bid (YES ask = 100 − best NO bid), and vice versa.
    const opposite = bestBidCents(side === "YES" ? ob.no_dollars : ob.yes_dollars);
    if (opposite == null) return null;
    return Math.max(1, Math.min(99, 100 - opposite));
  } catch {
    return null;
  }
}
