// Display-only: official Polymarket 5m strike ("price to beat", Chainlink open)
// and live UP midpoint for the CURRENT btc-updown-5m window. The slug
// timestamp is the window START. Not used by any bot.
import { createServerFn } from "@tanstack/react-start";

async function j(url: string): Promise<any> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
      return r.ok ? await r.json() : null;
    } finally { clearTimeout(t); }
  } catch { return null; }
}

const tokenCache = new Map<number, string | null>();
const strikeCache = new Map<number, number>();

export const fetchPolymarket5m = createServerFn({ method: "GET" })
  .inputValidator((d: { startMs: number }) => ({ startMs: Math.floor(Number(d.startMs) / 300_000) * 300_000 }))
  .handler(async ({ data }) => {
    const startSec = data.startMs / 1000;
    const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");

    let strike = strikeCache.get(startSec) ?? null;
    const strikeP = strike != null ? Promise.resolve(null) : j(
      // twapEnabled + 60s lookback = Polymarket's official "price to beat" (matches gamma eventMetadata.priceToBeat).
      `https://polymarket.com/api/crypto/crypto-price?symbol=BTC&eventStartTime=${iso(startSec)}&variant=fiveminute&endDate=${iso(startSec + 300)}&twapEnabled=true&twapLookbackSeconds=60`,
    );

    let token = tokenCache.get(startSec);
    if (token === undefined) {
      const ev = await j(`https://gamma-api.polymarket.com/events?slug=btc-updown-5m-${startSec}`);
      const m = Array.isArray(ev) ? ev[0]?.markets?.[0] : null;
      let outcomes: string[] = [], tokens: string[] = [];
      try { outcomes = typeof m?.outcomes === "string" ? JSON.parse(m.outcomes) : m?.outcomes ?? []; } catch { /* */ }
      try { tokens = typeof m?.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : m?.clobTokenIds ?? []; } catch { /* */ }
      const i = outcomes.findIndex((o) => String(o).toLowerCase() === "up");
      token = i >= 0 && tokens[i] ? String(tokens[i]) : null;
      if (token) tokenCache.set(startSec, token);
      if (tokenCache.size > 20) tokenCache.delete(tokenCache.keys().next().value as number);
    }

    const [sp, mid] = await Promise.all([
      strikeP,
      token ? j(`https://clob.polymarket.com/midpoint?token_id=${token}`) : Promise.resolve(null),
    ]);
    const open = Number(sp?.openPrice);
    if (strike == null && Number.isFinite(open) && open > 0) {
      strike = open;
      strikeCache.set(startSec, open);
      if (strikeCache.size > 20) strikeCache.delete(strikeCache.keys().next().value as number);
    }
    const up = Number(mid?.mid);
    return { startMs: data.startMs, strike, upMid: Number.isFinite(up) && up > 0 ? up : null };
  });
