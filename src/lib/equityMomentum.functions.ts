// Equity momentum signal — SPY, QQQ, ES=F, NQ=F
// Polled from Finnhub; used as a leading indicator for BTC (display-only at first).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

const SYMBOLS = [
  { symbol: "SPY", label: "SPY", weight: 0.4, kind: "stock" as const },
  { symbol: "QQQ", label: "QQQ", weight: 0.4, kind: "stock" as const },
  { symbol: "ES=F", label: "ES", weight: 0.1, kind: "future" as const },
  { symbol: "NQ=F", label: "NQ", weight: 0.1, kind: "future" as const },
];

export interface EquitySymbolSignal {
  symbol: string;
  label: string;
  price: number | null;
  ret30sPct: number | null;
  ret1mPct: number | null;
  sigma: number | null;          // z-score of 1m return vs trailing 20-bar stdev
  direction: "up" | "down" | "flat";
  available: boolean;
  note?: string;
}

export interface EquitySignalResult {
  asOf: string;
  symbols: EquitySymbolSignal[];
  score: number;                 // weighted avg of 1m returns (%), with sign
  sigma: number;                 // weighted avg |sigma|
  regime: "risk_on" | "risk_off" | "neutral";
  strength: "mild" | "strong" | "none";
  // Hypothetical effect on BTC auto-trade (not wired in yet)
  btcImpact: {
    edgeAdjustPts: number;       // +pts if aligns with YES (up), -pts if down
    wouldBlock: "none" | "block_up" | "block_down";
    explanation: string;
  };
}

// Tiny in-memory cache to respect Finnhub's 60 req/min free tier (~15s ttl).
const cache = new Map<string, { ts: number; data: any }>();
const TTL_MS = 12_000;

async function finnhubGet(path: string, key: string): Promise<any> {
  const url = `${FINNHUB_BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(key)}`;
  const cached = cache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < TTL_MS) return cached.data;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Finnhub ${res.status}: ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  cache.set(url, { ts: now, data });
  return data;
}

interface Candles { s: string; c?: number[]; t?: number[]; o?: number[]; h?: number[]; l?: number[]; v?: number[] }

function pct(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

async function loadSymbol(s: typeof SYMBOLS[number], key: string): Promise<EquitySymbolSignal> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 60 * 30; // last 30 min of 1-min candles
  try {
    const path = `/stock/candle?symbol=${encodeURIComponent(s.symbol)}&resolution=1&from=${from}&to=${now}`;
    const candles: Candles = await finnhubGet(path, key);
    if (candles.s !== "ok" || !candles.c || candles.c.length < 2) {
      // Likely free-tier doesn't include this symbol (futures usually need paid plan)
      // Try fallback /quote for stocks only.
      if (s.kind === "stock") {
        const quote = await finnhubGet(`/quote?symbol=${encodeURIComponent(s.symbol)}`, key);
        if (typeof quote?.c === "number" && quote.c > 0) {
          const ret1m = pct(quote.c, quote.pc ?? quote.c);
          return {
            symbol: s.symbol, label: s.label, price: quote.c,
            ret30sPct: null, ret1mPct: ret1m,
            sigma: null, direction: ret1m == null ? "flat" : ret1m > 0.02 ? "up" : ret1m < -0.02 ? "down" : "flat",
            available: true, note: "quote-fallback",
          };
        }
      }
      return { symbol: s.symbol, label: s.label, price: null, ret30sPct: null, ret1mPct: null, sigma: null, direction: "flat", available: false, note: "no_data" };
    }
    const closes = candles.c;
    const last = closes[closes.length - 1];
    const prev1 = closes[closes.length - 2];
    const prev0p5 = closes[closes.length - 1]; // no sub-minute candle on free plan; approximate 30s = current vs prev
    const ret1m = pct(last, prev1);
    // Compute returns series for sigma
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const r = pct(closes[i], closes[i - 1]);
      if (r != null) rets.push(r);
    }
    const sd = stdev(rets.slice(-20));
    const sigma = ret1m != null && sd > 0 ? ret1m / sd : null;
    return {
      symbol: s.symbol, label: s.label, price: last,
      ret30sPct: pct(last, prev0p5),
      ret1mPct: ret1m,
      sigma,
      direction: ret1m == null ? "flat" : ret1m > 0.02 ? "up" : ret1m < -0.02 ? "down" : "flat",
      available: true,
    };
  } catch (e: any) {
    return { symbol: s.symbol, label: s.label, price: null, ret30sPct: null, ret1mPct: null, sigma: null, direction: "flat", available: false, note: e?.message?.slice(0, 80) ?? "error" };
  }
}

export async function computeEquitySignal(): Promise<EquitySignalResult> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    return {
      asOf: new Date().toISOString(),
      symbols: SYMBOLS.map(s => ({ symbol: s.symbol, label: s.label, price: null, ret30sPct: null, ret1mPct: null, sigma: null, direction: "flat", available: false, note: "no_api_key" })),
      score: 0, sigma: 0, regime: "neutral", strength: "none",
      btcImpact: { edgeAdjustPts: 0, wouldBlock: "none", explanation: "FINNHUB_API_KEY not set." },
    };
  }
  const symbols = await Promise.all(SYMBOLS.map(s => loadSymbol(s, key)));
  let totalW = 0, scoreW = 0, sigmaW = 0;
  for (let i = 0; i < SYMBOLS.length; i++) {
    const sig = symbols[i];
    if (!sig.available || sig.ret1mPct == null) continue;
    totalW += SYMBOLS[i].weight;
    scoreW += SYMBOLS[i].weight * sig.ret1mPct;
    sigmaW += SYMBOLS[i].weight * Math.abs(sig.sigma ?? 0);
  }
  const score = totalW > 0 ? scoreW / totalW : 0;
  const sigmaAvg = totalW > 0 ? sigmaW / totalW : 0;
  const absScore = Math.abs(score);
  const regime: EquitySignalResult["regime"] = absScore < 0.03 ? "neutral" : score > 0 ? "risk_on" : "risk_off";
  const strength: EquitySignalResult["strength"] =
    regime === "neutral" ? "none" : sigmaAvg >= 1.5 || absScore >= 0.15 ? "strong" : "mild";
  const edgeAdjustPts = regime === "neutral" ? 0 : (strength === "strong" ? 3 : 1) * (regime === "risk_on" ? 1 : -1);
  const wouldBlock: EquitySignalResult["btcImpact"]["wouldBlock"] =
    strength === "strong" && regime === "risk_off" ? "block_up"
    : strength === "strong" && regime === "risk_on" ? "block_down"
    : "none";
  const dirText = regime === "risk_on" ? "UP" : regime === "risk_off" ? "DOWN" : "flat";
  const explanation =
    regime === "neutral" ? "Equities flat — no adjustment."
    : `Equities ${dirText} (${strength}) → ${edgeAdjustPts >= 0 ? "+" : ""}${edgeAdjustPts}pt edge to BTC ${dirText}${wouldBlock !== "none" ? `, would block opposite-direction trade` : ""}.`;
  return {
    asOf: new Date().toISOString(),
    symbols, score, sigma: sigmaAvg, regime, strength,
    btcImpact: { edgeAdjustPts, wouldBlock, explanation },
  };
}

export const getEquitySignal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<EquitySignalResult> => computeEquitySignal());

