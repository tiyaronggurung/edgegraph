// Polymarket US signed API client (server only). Ed25519 signature of timestamp+method+path.
const BASE = "https://api.polymarket.us";
let keyPromise: Promise<CryptoKey> | null = null;

function b64ToBytes(s: string) {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const bytesToB64 = (b: ArrayBuffer) => {
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s);
};

function getKey() {
  if (!keyPromise) {
    const secret = process.env["POLYMARKET_SECRET_KEY"];
    if (!secret) throw new Error("Polymarket keys not set");
    const seed = b64ToBytes(secret).slice(0, 32);
    const prefix = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
    const der = new Uint8Array(48);
    der.set(prefix); der.set(seed, 16);
    keyPromise = crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]) as Promise<CryptoKey>;
  }
  return keyPromise;
}

export const hasPolymarketKeys = () => !!process.env["POLYMARKET_KEY_ID"] && !!process.env["POLYMARKET_SECRET_KEY"];

export async function pmRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const ts = String(Date.now());
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, await getKey(), new TextEncoder().encode(ts + method + path.split("?")[0]));
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(BASE + path, {
      method,
      signal: ac.signal,
      headers: {
        "X-PM-Access-Key": process.env["POLYMARKET_KEY_ID"]!,
        "X-PM-Timestamp": ts,
        "X-PM-Signature": bytesToB64(sig),
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* keep text */ }
    return { ok: r.ok, status: r.status, data };
  } finally { clearTimeout(t); }
}

/** Immediate-or-cancel limit order; waits up to 3s for fills. Returns filled qty from executions or order lookup. */
export async function placeIocOrder(p: { marketSlug: string; intent: string; longPx: number; quantity: number }) {
  const res = await pmRequest("POST", "/v1/orders", {
    marketSlug: p.marketSlug,
    intent: p.intent,
    type: "ORDER_TYPE_LIMIT",
    price: { value: p.longPx.toFixed(3), currency: "USD" },
    quantity: p.quantity,
    tif: "TIME_IN_FORCE_IMMEDIATE_OR_CANCEL",
    manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
    synchronousExecution: true,
    maxBlockTime: "3",
  });
  if (!res.ok) return { ok: false as const, error: `${res.status} ${typeof res.data === "string" ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200)}`, raw: res.data };
  const id: string | null = res.data?.id ?? null;
  let filled = 0;
  for (const e of res.data?.executions ?? []) filled = Math.max(filled, Number(e?.order?.cumQuantity ?? 0));
  if (!filled && id) {
    const o = await pmRequest("GET", `/v1/order/${id}`);
    filled = Number(o.data?.order?.cumQuantity ?? o.data?.cumQuantity ?? 0);
  }
  return { ok: true as const, id, filled, raw: res.data };
}

/** Best UP (YES) bid/ask from the exchange's live book (signed read). */
export async function fetchBestUpQuotes(marketSlug: string): Promise<{ bid: number | null; ask: number | null }> {
  const r = await pmRequest("GET", `/v1/markets/${marketSlug}/book`);
  const md = r.data?.marketData;
  const px = (l: any) => { const n = Number(l?.[0]?.px?.value); return Number.isFinite(n) && n > 0 && n < 1 ? n : null; };
  const book = { bid: px(md?.bids), ask: px(md?.offers) };
  if (book.bid != null || book.ask != null) return book;
  // New windows can 404 on the book for a few minutes; fall back to the market's fresh best bid/ask.
  const ev = await fetch(`https://gateway.polymarket.us/v1/events/slug/${marketSlug.replace(/^cpc-/, "")}`, { headers: { accept: "application/json" } })
    .then((x) => (x.ok ? x.json() : null)).catch(() => null);
  const m = ev?.event?.markets?.[0];
  const one = (q: any) => px([{ px: q }]);
  return { bid: one(m?.bestBidQuote), ask: one(m?.bestAskQuote) };
}
