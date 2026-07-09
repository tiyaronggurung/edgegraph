// Polymarket 5-min BTC Up/Down odds — additional signal for Kalshi auto-trade.
// Fail-open: any error returns null; callers must treat null as "no signal,
// don't block the trade". Short cache avoids hammering APIs.
//
// Strategy for real-time price:
//   1. Once per 5-min window, hit gamma-api to resolve the market + CLOB
//      token IDs (this data doesn't change within a window).
//   2. On every call, hit CLOB /midpoint and /price (last trade) for the Up
//      token — these move as trades/quotes update, unlike gamma's cached
//      outcomePrices which can sit static for minutes.

export interface PolymarketBtcOdds {
  upProb: number;         // 0..1 · live CLOB midpoint of Up token
  downProb: number;       // 0..1 · 1 - upProb
  slug: string;
  windowStartMs: number;
  windowEndMs: number;
  bestBid: number;        // 0..1 · best bid on Up token
  bestAsk: number;        // 0..1 · best ask on Up token
  lastTrade: number;      // 0..1 · last trade price of Up token (0 if none)
  upTokenId: string;
  fetchedAt: number;
  downMid: number | null; // 0..1 · live CLOB midpoint of Down token (null if unavailable)
  effectiveUpProb: number; // 0..1 · blended Up prob using both sides of the book
}

const WINDOW_META_CACHE_MS = 60_000; // token IDs stable within a window
const LIVE_CACHE_MS = 1_000;         // near-realtime price refresh

interface WindowMeta {
  slug: string;
  windowStartMs: number;
  windowEndMs: number;
  upTokenId: string;
  downTokenId: string;
  gammaBestBid: number;
  gammaBestAsk: number;
}

let metaCache: { at: number; key: string; meta: WindowMeta | null } | null = null;
let priceCache: { at: number; key: string; data: PolymarketBtcOdds | null } | null = null;

async function fetchJson(url: string, timeoutMs = 2500): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function resolveWindow(nowMs: number): Promise<WindowMeta | null> {
  const winStartSec = Math.floor(nowMs / 1000 / 300) * 300;
  // Polymarket slug uses close time; tradable market is upcoming window.
  const candidates = [winStartSec + 300, winStartSec, winStartSec + 600];
  const key = candidates.join(",");
  if (metaCache && metaCache.key === key && nowMs - metaCache.at < WINDOW_META_CACHE_MS) {
    return metaCache.meta;
  }
  for (const closeSec of candidates) {
    const slug = `btc-updown-5m-${closeSec}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await fetchJson(`https://gamma-api.polymarket.com/events?slug=${slug}`)) as any;
    if (!Array.isArray(j) || j.length === 0) continue;
    const m = j[0]?.markets?.[0];
    if (!m) continue;
    const outcomes: string[] = safeParseJsonArray(m.outcomes) ?? ["Up", "Down"];
    const tokens: string[] = safeParseJsonArray(m.clobTokenIds) ?? [];
    const upIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "up");
    const downIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "down");
    if (upIdx < 0 || downIdx < 0 || !tokens[upIdx] || !tokens[downIdx]) continue;
    const meta: WindowMeta = {
      slug,
      windowStartMs: (closeSec - 300) * 1000,
      windowEndMs: closeSec * 1000,
      upTokenId: String(tokens[upIdx]),
      downTokenId: String(tokens[downIdx]),
      gammaBestBid: Number(m.bestBid ?? 0),
      gammaBestAsk: Number(m.bestAsk ?? 0),
    };
    metaCache = { at: nowMs, key, meta };
    return meta;
  }
  metaCache = { at: nowMs, key, meta: null };
  return null;
}

/**
 * Fetch live Polymarket BTC 5-min Up/Down odds. Uses CLOB midpoint + book
 * top-of-book for real-time price (updates every second as quotes change).
 * Returns null on any failure. 1s in-memory cache.
 */
export async function getPolymarketBtcUpDown(
  nowMs: number = Date.now(),
): Promise<PolymarketBtcOdds | null> {
  const meta = await resolveWindow(nowMs);
  if (!meta) return null;

  if (priceCache && priceCache.key === meta.upTokenId && nowMs - priceCache.at < LIVE_CACHE_MS) {
    return priceCache.data;
  }

  // Parallel: Up mid, Up book, Up last-trade, Down mid.
  // Down mid is the second real signal — when the Up book sits flat at 0.505
  // because nobody's quoting Up, the Down side often carries the lean.
  const [midJ, bookJ, priceJ, downMidJ] = await Promise.all([
    fetchJson(`https://clob.polymarket.com/midpoint?token_id=${meta.upTokenId}`),
    fetchJson(`https://clob.polymarket.com/book?token_id=${meta.upTokenId}`),
    fetchJson(`https://clob.polymarket.com/price?token_id=${meta.upTokenId}&side=BUY`),
    fetchJson(`https://clob.polymarket.com/midpoint?token_id=${meta.downTokenId}`),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mid = Number((midJ as any)?.mid);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = bookJ as any;
  const bids: Array<{ price: string; size: string }> = Array.isArray(book?.bids) ? book.bids : [];
  const asks: Array<{ price: string; size: string }> = Array.isArray(book?.asks) ? book.asks : [];
  // Polymarket returns bids ascending, asks descending — highest bid is last, lowest ask is last.
  const bestBid = bids.length ? Number(bids[bids.length - 1]?.price) : meta.gammaBestBid;
  const bestAsk = asks.length ? Number(asks[asks.length - 1]?.price) : meta.gammaBestAsk;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastTrade = Number((priceJ as any)?.price ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const downMidRaw = Number((downMidJ as any)?.mid);
  const downMid = Number.isFinite(downMidRaw) && downMidRaw > 0 ? clamp01(downMidRaw) : null;

  const upProb = Number.isFinite(mid) && mid > 0 ? clamp01(mid)
    : Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestBid > 0 && bestAsk > 0
      ? clamp01((bestBid + bestAsk) / 2)
      : null;
  if (upProb == null) {
    priceCache = { at: nowMs, key: meta.upTokenId, data: null };
    return null;
  }

  // Effective Up prob: average of Up-mid and (1 - Down-mid) when Down side is
  // available. When both books quote actively, they must sum to ~1; if one
  // sits stale at 0.505 while the other leans, the blend pulls toward the
  // active side. Falls back to Up-mid alone when Down mid is unavailable.
  const effectiveUpProb = downMid != null
    ? clamp01((upProb + (1 - downMid)) / 2)
    : upProb;

  const data: PolymarketBtcOdds = {
    upProb,
    downProb: clamp01(1 - upProb),
    slug: meta.slug,
    windowStartMs: meta.windowStartMs,
    windowEndMs: meta.windowEndMs,
    bestBid: Number.isFinite(bestBid) ? clamp01(bestBid) : 0,
    bestAsk: Number.isFinite(bestAsk) ? clamp01(bestAsk) : 0,
    lastTrade: Number.isFinite(lastTrade) ? clamp01(lastTrade) : 0,
    upTokenId: meta.upTokenId,
    fetchedAt: nowMs,
    downMid,
    effectiveUpProb,
  };
  priceCache = { at: nowMs, key: meta.upTokenId, data };
  return data;
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
