// Side-by-side recorder: our composite BTC price vs a CF-style reference
// price (the index family Kalshi settles BTC on).
//
// Completely isolated: reads public exchange tickers, writes only its own
// table (btc_spot_buffer_log). No existing engine, hook or view is touched.
//
// our_composite  = the weights the app's live composite uses
//                  (Coinbase .50, Bitstamp .20, Binance .20, Bitfinex .10)
// cf_reference   = equal-weight median-trimmed mean of the CF Bitcoin
//                  Reference Rate constituents we can reach publicly
//                  (Coinbase, Bitstamp, Kraken, Gemini, LMAX n/a)
// buffer_usd     = our_composite - cf_reference

// Mirrors src/hooks/useLiveCompositeSpot.ts. Binance/Bitfinex were dropped on
// 2026-09-22 after 270 measured samples showed them running +$11.5 / +$14.7
// above the settlement reference, biasing our composite ~+$4.
const OUR_WEIGHTS: Record<string, number> = {
  coinbase: 0.7,
  bitstamp: 0.3,
};
const CF_VENUES = ["coinbase", "bitstamp", "kraken", "gemini"] as const;

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json", "User-Agent": "edgegraph/1.0" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()) as T;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function coinbase() {
  const d = await j<{ price?: string }>("https://api.exchange.coinbase.com/products/BTC-USD/ticker");
  return num(d.price);
}
async function bitstamp() {
  const d = await j<{ last?: string }>("https://www.bitstamp.net/api/v2/ticker/btcusd/");
  return num(d.last);
}
async function kraken() {
  const d = await j<{ result?: Record<string, { c?: string[] }> }>(
    "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
  );
  return num(Object.values(d.result ?? {})[0]?.c?.[0]);
}
async function gemini() {
  const d = await j<{ last?: string }>("https://api.gemini.com/v1/pubticker/btcusd");
  return num(d.last);
}
async function binance() {
  const { binanceFetch } = await import("@/lib/binanceFetch");
  const r = await binanceFetch("/api/v3/ticker/price?symbol=BTCUSDT", {
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const d = (await r.json()) as { price?: string };
  return num(d.price);
}
async function bitfinex() {
  const d = await j<number[]>("https://api-pub.bitfinex.com/v2/ticker/tBTCUSD");
  return num(d?.[6]);
}

export interface SpotBufferSnapshot {
  ourComposite: number | null;
  cfReference: number | null;
  bufferUsd: number | null;
  bufferBps: number | null;
  venues: Record<string, number | null>;
  strike: number | null;
  written: boolean;
}

export async function recordSpotBuffer(): Promise<SpotBufferSnapshot> {
  const [cb, bs, kr, gm, bn, bf, strikeRes] = await Promise.all([
    coinbase().catch(() => null),
    bitstamp().catch(() => null),
    kraken().catch(() => null),
    gemini().catch(() => null),
    binance().catch(() => null),
    bitfinex().catch(() => null),
    import("@/lib/kalshiCurrentStrike.functions")
      .then((m) => m.loadKalshiCurrentStrike())
      .catch(() => null),
  ]);

  const venues: Record<string, number | null> = {
    coinbase: cb, bitstamp: bs, kraken: kr, gemini: gm, binance: bn, bitfinex: bf,
  };

  // Our composite: renormalized weights over the venues that answered.
  let wSum = 0, pSum = 0;
  for (const [v, w] of Object.entries(OUR_WEIGHTS)) {
    const p = venues[v];
    if (p != null) { wSum += w; pSum += w * p; }
  }
  const ourComposite = wSum > 0 ? pSum / wSum : null;

  // CF-style reference: equal weight over the CF constituents that answered.
  const cfPrices = CF_VENUES.map((v) => venues[v]).filter((p): p is number => p != null);
  const cfReference = cfPrices.length
    ? cfPrices.reduce((a, b) => a + b, 0) / cfPrices.length
    : null;

  const bufferUsd =
    ourComposite != null && cfReference != null ? ourComposite - cfReference : null;
  const bufferBps =
    bufferUsd != null && cfReference ? (bufferUsd / cfReference) * 10_000 : null;

  const now = Date.now();
  const windowStart = Math.floor(now / 900_000) * 900_000;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("btc_spot_buffer_log").insert({
    window_start: new Date(windowStart).toISOString(),
    seconds_to_close: Math.max(0, Math.round((windowStart + 900_000 - now) / 1000)),
    coinbase_px: cb,
    bitstamp_px: bs,
    kraken_px: kr,
    gemini_px: gm,
    binance_px: bn,
    bitfinex_px: bf,
    our_composite: ourComposite,
    cf_reference: cfReference,
    buffer_usd: bufferUsd,
    buffer_bps: bufferBps,
    venues_used: cfPrices.length,
    strike: strikeRes?.strike ?? null,
  } as never);

  return {
    ourComposite,
    cfReference,
    bufferUsd,
    bufferBps,
    venues,
    strike: strikeRes?.strike ?? null,
    written: !error,
  };
}
