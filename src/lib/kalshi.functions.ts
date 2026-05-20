// Kalshi public market data — sports category.
// Uses unauthenticated /trade-api/v2 endpoints. No API key required.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";

export interface KalshiMarketLite {
  ticker: string;
  yesSubTitle: string;
  yesPrice: number; // 0..1
  volume24h: number;
  openInterest: number;
  recentYes: number[]; // recent yes prices (oldest -> newest) for sparkline
}

export interface KalshiEventLite {
  eventTicker: string;
  seriesTicker: string;
  title: string;
  subTitle: string;
  category: string;
  competition: string;
  markets: KalshiMarketLite[];
}

async function kalshiFetch(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Kalshi ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

export const getKalshiSportsEvents = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; seriesTicker?: string } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<{ events: KalshiEventLite[] }> => {
    const limit = Math.min(Math.max(data.limit ?? 12, 1), 50);
    const params = new URLSearchParams({
      status: "open",
      with_nested_markets: "true",
      limit: String(limit),
    });
    if (data.seriesTicker) params.set("series_ticker", data.seriesTicker);
    // The events endpoint doesn't filter by category directly for nested markets,
    // so we pull a broader set and filter for Sports below.
    const json = await kalshiFetch(`/events?${params.toString()}`);
    const all: any[] = json.events ?? [];
    const sports = all.filter((e) => (e.category ?? "").toLowerCase() === "sports").slice(0, limit);

    const events: KalshiEventLite[] = sports.map((e) => ({
      eventTicker: e.event_ticker,
      seriesTicker: e.series_ticker,
      title: e.title,
      subTitle: e.sub_title ?? "",
      category: e.category ?? "Sports",
      competition: e.product_metadata?.competition ?? "",
      markets: (e.markets ?? [])
        .filter((m: any) => m.status === "active")
        .slice(0, 6)
        .map((m: any) => ({
          ticker: m.ticker,
          yesSubTitle: m.yes_sub_title ?? m.ticker,
          yesPrice: Number(m.last_price_dollars ?? m.yes_bid_dollars ?? 0),
          volume24h: Number(m.volume_24h ?? 0),
          openInterest: Number(m.open_interest_fp ?? m.open_interest ?? 0),
          recentYes: [],
        })),
    }));

    return { events };
  });

export const getKalshiMarketHistory = createServerFn({ method: "GET" })
  .inputValidator(z.object({ ticker: z.string().min(1).max(120), limit: z.number().int().min(5).max(200).optional() }))
  .handler(async ({ data }): Promise<{ ticker: string; series: number[] }> => {
    const limit = data.limit ?? 60;
    const json = await kalshiFetch(`/markets/trades?ticker=${encodeURIComponent(data.ticker)}&limit=${limit}`);
    const trades: any[] = json.trades ?? [];
    // Trades come newest first → reverse to oldest first for left-to-right charting.
    const series = trades
      .map((t) => Number(t.yes_price_dollars))
      .filter((n) => Number.isFinite(n))
      .reverse();
    return { ticker: data.ticker, series };
  });
