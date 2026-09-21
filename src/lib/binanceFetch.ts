// Binance market-data fetch with host failover.
//
// The production edge region is geo-blocked by api.binance.com (HTTP 451).
// data-api.binance.vision is Binance's public market-data mirror and is not
// geo-restricted; api.binance.us is a last resort. Same REST paths on all.
//
// Usage: binanceFetch("/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=31")

const HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api.binance.us",
];

/** Remembers the host that last worked so we don't retry a blocked one. */
let preferred = 0;

const HOST_TIMEOUT_MS = 1_800;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOST_TIMEOUT_MS);
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

export async function binanceFetch(path: string, init?: RequestInit): Promise<Response> {
  const globalOrder = [preferred, 0, 1].filter((i, pos, arr) => i < 2 && arr.indexOf(i) === pos);
  const attempts = globalOrder.map(async (i) => {
    try {
      const res = await fetchWithTimeout(`${HOSTS[i]}${path}`, init);
      if (res.ok) {
        preferred = i;
        return res;
      }
      throw new Error(`binance ${res.status}`);
    } catch (error) {
      throw error instanceof Error ? error : new Error("binance unreachable");
    }
  });
  try {
    // Race equivalent global mirrors so a blocked host never delays a healthy one.
    // Binance US has different liquidity and is only a last-resort fallback.
    return await Promise.any(attempts);
  } catch {
    const fallback = await fetchWithTimeout(`${HOSTS[2]}${path}`, init);
    if (fallback.ok) return fallback;
    throw new Error(`binance ${fallback.status}`);
  }
}

/** Convenience: JSON body or throw with the failing status. */
export async function binanceJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await binanceFetch(path, init);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  return (await res.json()) as T;
}
