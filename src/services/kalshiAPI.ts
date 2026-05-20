// Placeholder Kalshi market connector. Real keys plug in via Settings → API Connectors.
// TODO: replace fake feed with authenticated Kalshi REST/WS calls.

export interface KalshiMarket {
  ticker: string;
  title: string;
  yesProbability: number;
  noProbability: number;
  volume: number;
}

export async function fetchKalshiMarkets(): Promise<KalshiMarket[]> {
  return [];
}

export const kalshiConnectionStatus = () => ({ connected: false, lastSync: null as string | null });
