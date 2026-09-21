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
  const order = [preferred, ...HOSTS.map((_, i) => i).filter((i) => i !== preferred)];
  let last: Response | null = null;
  let lastErr: unknown = null;
  for (const i of order) {
    try {
      const res = await fetchWithTimeout(`${HOSTS[i]}${path}`, init);
      if (res.ok) {
        preferred = i;
        return res;
      }
      // 451/403/418/429 => region block or throttle: try the next host.
      last = res;
      if (res.status < 400) return res;
    } catch (e) {
      lastErr = e;
    }
  }
  if (last) return last;
  throw (lastErr instanceof Error ? lastErr : new Error("binance unreachable"));
}

/** Convenience: JSON body or throw with the failing status. */
export async function binanceJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await binanceFetch(path, init);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  return (await res.json()) as T;
}
