// Polymarket BTC Up/Down taker-flow volume.
// Polymarket runs 5-minute BTC windows, so a "15m" view is the current window
// plus the two prior windows stitched together. Fail-open: errors return null.

export interface PolyVolumeSide {
  upShares: number;   // contracts taking the Up side
  downShares: number; // contracts taking the Down side
  upNotional: number; // $ paid for Up side
  downNotional: number;
  trades: number;
}

export interface PolymarketVolume {
  window: PolyVolumeSide;   // current 5m window
  w15: PolyVolumeSide;      // current + 2 prior 5m windows (~15m)
  s60: PolyVolumeSide;      // last 60 seconds
  avgCostUp: number | null;   // avg ¢ paid for Up over 15m (0..1)
  avgCostDown: number | null; // avg ¢ paid for Down over 15m (0..1)
  imbalance: number | null;   // (up - down) / total, current window
  imbalance15m: number | null;
  imbalance60s: number | null;
  slug: string;
  fetchedAt: number;
}

const CACHE_MS = 5_000;
let cache: { at: number; data: PolymarketVolume | null } | null = null;

interface PolyTrade {
  side: string;
  outcome: string;
  size: number;
  price: number;
  timestamp: number;
}

function empty(): PolyVolumeSide {
  return { upShares: 0, downShares: 0, upNotional: 0, downNotional: 0, trades: 0 };
}

function add(acc: PolyVolumeSide, t: PolyTrade) {
  const isUpOutcome = String(t.outcome).toLowerCase() === "up";
  const isBuy = String(t.side).toUpperCase() === "BUY";
  // Buying Up == taking Up; selling Down == taking Up (and vice versa).
  const takesUp = isBuy === isUpOutcome;
  const notional = t.size * t.price;
  if (takesUp) {
    acc.upShares += t.size;
    acc.upNotional += notional;
  } else {
    acc.downShares += t.size;
    acc.downNotional += notional;
  }
  acc.trades += 1;
}

function imb(a: PolyVolumeSide): number | null {
  const tot = a.upShares + a.downShares;
  return tot > 0 ? (a.upShares - a.downShares) / tot : null;
}

async function fetchJson(url: string, timeoutMs = 3000): Promise<unknown | null> {
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

async function conditionIdForSlug(slug: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await fetchJson(`https://gamma-api.polymarket.com/events?slug=${slug}`)) as any;
  const c = Array.isArray(j) ? j[0]?.markets?.[0]?.conditionId : null;
  return c ? String(c) : null;
}

async function tradesFor(conditionId: string): Promise<PolyTrade[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await fetchJson(
    `https://data-api.polymarket.com/trades?market=${conditionId}&limit=1000`,
  )) as any;
  if (!Array.isArray(j)) return [];
  return j
    .map((t) => ({
      side: String(t?.side ?? ""),
      outcome: String(t?.outcome ?? ""),
      size: Number(t?.size ?? 0),
      price: Number(t?.price ?? 0),
      timestamp: Number(t?.timestamp ?? 0),
    }))
    .filter((t) => Number.isFinite(t.size) && t.size > 0 && Number.isFinite(t.price));
}

export async function getPolymarketBtcVolume(
  nowMs: number = Date.now(),
): Promise<PolymarketVolume | null> {
  if (cache && nowMs - cache.at < CACHE_MS) return cache.data;

  const winStartSec = Math.floor(nowMs / 1000 / 300) * 300;
  // Current tradable window closes at the next 5m boundary.
  const closeSecs = [winStartSec + 300, winStartSec, winStartSec - 300];

  const conds = await Promise.all(
    closeSecs.map((s) => conditionIdForSlug(`btc-updown-5m-${s}`)),
  );
  if (!conds[0]) {
    // Do not retain a transient Gamma miss across the next refresh. This is
    // common for a few seconds at a five-minute market rollover.
    return null;
  }
  const tradeLists = await Promise.all(
    conds.map((c) => (c ? tradesFor(c) : Promise.resolve([] as PolyTrade[]))),
  );

  const windowAcc = empty();
  const w15Acc = empty();
  const s60Acc = empty();
  const nowSec = Math.floor(nowMs / 1000);

  tradeLists.forEach((list, i) => {
    for (const t of list) {
      add(w15Acc, t);
      if (i === 0) add(windowAcc, t);
      if (nowSec - t.timestamp <= 60) add(s60Acc, t);
    }
  });

  const data: PolymarketVolume = {
    window: windowAcc,
    w15: w15Acc,
    s60: s60Acc,
    avgCostUp: w15Acc.upShares > 0 ? w15Acc.upNotional / w15Acc.upShares : null,
    avgCostDown: w15Acc.downShares > 0 ? w15Acc.downNotional / w15Acc.downShares : null,
    imbalance: imb(windowAcc),
    imbalance15m: imb(w15Acc),
    imbalance60s: imb(s60Acc),
    slug: `btc-updown-5m-${closeSecs[0]}`,
    fetchedAt: nowMs,
  };
  cache = { at: nowMs, data };
  return data;
}
