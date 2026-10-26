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
    // Polymarket US (polymarket.us, BRTI index) — the venue the user trades on.
    const d = new Date(data.startMs);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const usSlug = `btc-updown-5m-${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}z`;
    const cached = strikeCache.get(startSec) ?? null;
    const ev = await j(`https://gateway.polymarket.us/v1/events/slug/${usSlug}`);
    const m = ev?.event?.markets?.[0];
    const ptb = Number(m?.assetPriceTerms?.priceToBeat?.value);
    let strike = cached;
    if (strike == null && Number.isFinite(ptb) && ptb > 0) {
      strike = ptb;
      strikeCache.set(startSec, ptb);
      if (strikeCache.size > 20) strikeCache.delete(strikeCache.keys().next().value as number);
    }
    const sides: any[] = Array.isArray(m?.marketSides) ? m.marketSides : [];
    const yes = sides.find((s) => s?.long === true) ?? sides[0];
    const no = sides.find((s) => s?.long === false);
    const yAsk = Number(yes?.quote?.value);
    const nAsk = Number(no?.quote?.value);
    let up: number | null = null;
    if (Number.isFinite(yAsk) && Number.isFinite(nAsk) && yAsk > 0 && nAsk > 0) up = (yAsk + (1 - nAsk)) / 2;
    else if (Number.isFinite(Number(yes?.price))) up = Number(yes.price);
    return { startMs: data.startMs, strike, upMid: up != null && up > 0 && up < 1 ? up : null };
  });
