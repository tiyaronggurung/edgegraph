// Kalshi's settlement index (CF Benchmarks BRTI) from Kalshi's public mirror,
// plus the running 60s average Kalshi settles on. Display only.
import { createServerFn } from "@tanstack/react-start";

export interface BrtiSpot {
  ok: boolean;
  price: number | null;
  avg60: number | null;
  error: string | null;
}

export const getBrtiSpot = createServerFn({ method: "GET" }).handler(async (): Promise<BrtiSpot> => {
  try {
    const res = await fetch(
      "https://kalshi-public-docs.s3.amazonaws.com/external/crypto/btc_current.json",
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return { ok: false, price: null, avg60: null, error: `brti ${res.status}` };
    const j = (await res.json()) as { timeseries?: { second?: number[] } };
    const s = (j.timeseries?.second ?? []).filter((n) => Number.isFinite(n));
    if (!s.length) return { ok: false, price: null, avg60: null, error: "empty" };
    const last60 = s.slice(-60);
    const avg = last60.reduce((a, b) => a + b, 0) / last60.length;
    return { ok: true, price: s[s.length - 1], avg60: Number(avg.toFixed(2)), error: null };
  } catch (e) {
    return { ok: false, price: null, avg60: null, error: (e as Error).message };
  }
});
