// Kalshi public market data — sports category.
// Uses unauthenticated /trade-api/v2 endpoints. No API key required.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Known per-game series that contain live tradeable sports markets.
// Discovered via /series?limit=200 (tagged Basketball/Football/Baseball/Hockey/Soccer).
const GAME_SERIES = [
  { ticker: "KXNBAGAME", sport: "NBA" },
  { ticker: "KXWNBAGAME", sport: "WNBA" },
  { ticker: "KXNFLGAME", sport: "NFL" },
  { ticker: "KXMLBGAME", sport: "MLB" },
  { ticker: "KXNHLGAME", sport: "NHL" },
  { ticker: "KXEPLGAME", sport: "EPL Soccer" },
  { ticker: "KXMLSGAME", sport: "MLS Soccer" },
  { ticker: "KXUCLGAME", sport: "UCL Soccer" },
  { ticker: "KXLIGAMXSPREAD", sport: "Liga MX Soccer" },
  { ticker: "KXSUPERLIGGAME", sport: "Turkish Super Lig Soccer" },
  { ticker: "KXATPMATCH", sport: "ATP Tennis" },
  { ticker: "KXWTAMATCH", sport: "WTA Tennis" },
  { ticker: "KXATPCHALLENGERMATCH", sport: "ATP Challenger Tennis" },
  { ticker: "KXWTACHALLENGERMATCH", sport: "WTA Challenger Tennis" },
  { ticker: "KXATPDOUBLES", sport: "ATP Doubles Tennis" },
  { ticker: "KXWTADOUBLES", sport: "WTA Doubles Tennis" },
] as const;

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

function mapEvent(e: any, sportLabel: string): KalshiEventLite {
  return {
    eventTicker: e.event_ticker,
    seriesTicker: e.series_ticker,
    title: e.title,
    subTitle: e.sub_title ?? "",
    category: e.category ?? "Sports",
    competition: sportLabel,
    markets: (e.markets ?? [])
      .filter((m: any) => m.status === "active")
      .slice(0, 6)
      .map((m: any) => ({
        ticker: m.ticker,
        yesSubTitle: m.yes_sub_title ?? m.ticker,
        yesPrice: Number(m.last_price_dollars ?? m.yes_bid_dollars ?? 0),
        volume24h: Number(m.volume_24h_fp ?? m.volume_24h ?? 0),
        openInterest: Number(m.open_interest_fp ?? m.open_interest ?? 0),
        recentYes: [],
      })),
  };
}

export const getKalshiSportsEvents = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; seriesTicker?: string } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<{ events: KalshiEventLite[] }> => {
    const limit = Math.min(Math.max(data.limit ?? 30, 1), 80);

    // Single series fast-path.
    if (data.seriesTicker) {
      const params = new URLSearchParams({
        status: "open",
        with_nested_markets: "true",
        series_ticker: data.seriesTicker,
        limit: String(Math.min(limit, 50)),
      });
      const json = await kalshiFetch(`/events?${params.toString()}`);
      const label = GAME_SERIES.find((s) => s.ticker === data.seriesTicker)?.sport ?? "Sports";
      return { events: (json.events ?? []).map((e: any) => mapEvent(e, label)) };
    }

    // Fan out across all known game-series in parallel.
    const perSeries = Math.max(3, Math.ceil(limit / GAME_SERIES.length));
    const results = await Promise.all(
      GAME_SERIES.map(async ({ ticker, sport }) => {
        try {
          const params = new URLSearchParams({
            status: "open",
            with_nested_markets: "true",
            series_ticker: ticker,
            limit: String(perSeries),
          });
          const json = await kalshiFetch(`/events?${params.toString()}`);
          return ((json.events ?? []) as any[]).map((e) => mapEvent(e, sport));
        } catch {
          return [];
        }
      }),
    );

    // Flatten, keep only events with active markets, sort by best 24h volume desc.
    const all = results
      .flat()
      .filter((e) => e.markets.length > 0)
      .sort((a, b) => {
        const va = Math.max(0, ...a.markets.map((m) => m.volume24h));
        const vb = Math.max(0, ...b.markets.map((m) => m.volume24h));
        return vb - va;
      })
      .slice(0, limit);

    return { events: all };
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
