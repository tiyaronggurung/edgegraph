import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cronAuth";

// Server-side flow-lean recorder.
//
// The BTC price & volume card logs btc_flow_lean_log only while a browser tab
// is open, so most windows had no in/out volume rows at all. This job runs
// every minute from pg_cron and writes one row per window-minute regardless
// of the browser: window buy/sell BTC, imbalance, 3m imbalance, and the lean.
// Read-only against Binance klines (keyless), one insert per run, no AI.

type Kline = number[];

function leg(rows: Kline[]) {
  if (!rows.length) return null;
  let total = 0;
  let buy = 0;
  let quoteTotal = 0;
  let quoteBuy = 0;
  for (const r of rows) {
    const v = Number(r[5]);
    const tb = Number(r[9]);
    const q = Number(r[7]);
    const qb = Number(r[10]);
    if (Number.isFinite(v)) total += v;
    if (Number.isFinite(tb)) buy += tb;
    if (Number.isFinite(q)) quoteTotal += q;
    if (Number.isFinite(qb)) quoteBuy += qb;
  }
  const sell = Math.max(0, total - buy);
  const quoteSell = Math.max(0, quoteTotal - quoteBuy);
  return {
    buy,
    sell,
    total,
    quoteBuy,
    quoteSell,
    avgBuyPrice: buy > 0 ? quoteBuy / buy : null,
    avgSellPrice: sell > 0 ? quoteSell / sell : null,
    imbalance: total > 0 ? (buy - sell) / total : 0,
  };
}

function computeLean(imbM3: number | null): "UP" | "DOWN" | "FLAT" {
  if (imbM3 == null) return "FLAT";
  if (imbM3 > 0.1) return "UP";
  if (imbM3 < -0.1) return "DOWN";
  return "FLAT";
}

export const Route = createFileRoute("/api/public/hooks/flow-lean-writer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFail = await verifyCronRequest(request);
        if (authFail) return authFail;

        const t0 = Date.now();
        const now = Date.now();
        const winStartMs = Math.floor(now / 900_000) * 900_000;
        const secondsToClose = Math.max(0, Math.round((winStartMs + 900_000 - now) / 1000));

        const res = await fetch(
          "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=31",
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          return Response.json({ ok: false, error: `binance ${res.status}` }, { status: 502 });
        }
        const raw = (await res.json()) as unknown[][];
        const rows: Kline[] = raw
          .map((r) => r.map((x) => Number(x)))
          .filter((r) => Number.isFinite(r[0]));
        if (!rows.length) {
          return Response.json({ ok: false, error: "no klines" }, { status: 502 });
        }

        const closed = rows.filter((r) => r[6] < now);
        const winRows = rows.filter((r) => r[0] >= winStartMs);
        const w = leg(winRows);
        const m3 = leg(closed.slice(-3));
        const last = closed[closed.length - 1];
        const spot = last ? Number(last[4]) : null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Dedupe: one row per window per minute (browser logger may also write).
        const minuteStart = new Date(Math.floor(now / 60_000) * 60_000).toISOString();
        const minuteEnd = new Date(Math.floor(now / 60_000) * 60_000 + 60_000).toISOString();
        const winStartIso = new Date(winStartMs).toISOString();
        const { data: existing } = await supabaseAdmin
          .from("btc_flow_lean_log")
          .select("id")
          .eq("window_start", winStartIso)
          .gte("logged_at", minuteStart)
          .lt("logged_at", minuteEnd)
          .limit(1);
        if (existing && existing.length > 0) {
          return Response.json({ ok: true, skipped: "already_logged", ms: Date.now() - t0 });
        }

        const lean = computeLean(m3?.imbalance ?? null);
        const { error } = await supabaseAdmin.from("btc_flow_lean_log").insert({
          window_start: winStartIso,
          seconds_to_close: secondsToClose,
          lean,
          imb_m3: m3 ? Number(m3.imbalance.toFixed(4)) : null,
          imb_window: w ? Number(w.imbalance.toFixed(4)) : null,
          vol_window_btc: w ? Number(w.total.toFixed(4)) : null,
          buy_window_btc: w ? Number(w.buy.toFixed(4)) : null,
          sell_window_btc: w ? Number(w.sell.toFixed(4)) : null,
          buy_quote_usd: w ? Number(w.quoteBuy.toFixed(2)) : null,
          sell_quote_usd: w ? Number(w.quoteSell.toFixed(2)) : null,
          avg_buy_price: w?.avgBuyPrice != null ? Number(w.avgBuyPrice.toFixed(2)) : null,
          avg_sell_price: w?.avgSellPrice != null ? Number(w.avgSellPrice.toFixed(2)) : null,
          spot,
          expected_win_rate: null,
        });
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        return Response.json({
          ok: true,
          window_start: winStartIso,
          lean,
          imb_window: w?.imbalance ?? null,
          ms: Date.now() - t0,
        });
      },
    },
  },
});
