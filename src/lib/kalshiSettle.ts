// Authoritative Kalshi settlement lookup.
// Uses the public /markets/{ticker} endpoint. When the market is finalized,
// Kalshi's `result` ("yes"/"no") is the source of truth — do NOT infer the
// outcome from an internally-computed spot, which can drift a few dollars
// from Kalshi's official expiration_value and flip the outcome near-strike.

const BASE = "https://api.elections.kalshi.com/trade-api/v2";

export interface KalshiSettlement {
  finalized: boolean;
  result: "yes" | "no" | null;
  expirationValue: number | null; // official BTC price at expiration
}

export async function fetchKalshiSettlement(ticker: string): Promise<KalshiSettlement | null> {
  try {
    const res = await fetch(`${BASE}/markets/${encodeURIComponent(ticker)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const m = json?.market ?? {};
    const status = String(m.status ?? "");
    const finalized = status === "finalized" || status === "settled";
    const raw = String(m.result ?? "").toLowerCase();
    const result: "yes" | "no" | null = raw === "yes" ? "yes" : raw === "no" ? "no" : null;
    const ev = Number(m.expiration_value);
    return {
      finalized: finalized && result !== null,
      result,
      expirationValue: Number.isFinite(ev) ? ev : null,
    };
  } catch {
    return null;
  }
}
