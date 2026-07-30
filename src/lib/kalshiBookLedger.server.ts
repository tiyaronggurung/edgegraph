// Server-only: persist the Kalshi book economics for each 15m BTC window.
// Called every minute by cron.
//
// Design note: this used to call getKalshiImpliedSpot(), which re-pulls the
// ENTIRE window's trade tape (up to 12 pages) every single minute. Combined
// with the other crons that hammered Kalshi, that reliably tripped 429s and
// left whole windows missing from the ledger. This module now:
//   1. makes ONE cheap events call to find the active market,
//   2. pulls ONLY the trades newer than the last one we already counted,
//   3. accumulates volume / cost into the row (never re-reads history),
//   4. settles closed windows from our predictions, falling back to Kalshi's
//      own market result so every closed window ends with a real P/L.

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function kfetch(url: string, tries = 3): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) return null;
    await new Promise((r) => setTimeout(r, 900 * (i + 1)));
  }
  return null;
}

type ActiveMarket = { ticker: string; strike: number | null; closeMs: number };

async function findActiveMarket(): Promise<ActiveMarket | null> {
  const res = await kfetch(
    `${KALSHI}/events?status=open&with_nested_markets=true&series_ticker=KXBTC15M&limit=25`,
  );
  if (!res) return null;
  const json = (await res.json()) as {
    events?: Array<{
      markets?: Array<{
        ticker: string;
        close_time: string;
        floor_strike?: number;
        status?: string;
      }>;
    }>;
  };
  const now = Date.now();
  let best: ActiveMarket | null = null;
  for (const ev of json.events ?? []) {
    for (const m of ev.markets ?? []) {
      if (m.status && m.status !== "active") continue;
      const closeMs = new Date(m.close_time).getTime();
      if (!Number.isFinite(closeMs) || closeMs <= now) continue;
      if (!best || closeMs < best.closeMs) {
        best = { ticker: m.ticker, strike: num(m.floor_strike), closeMs };
      }
    }
  }
  return best;
}

type Trade = {
  taker_side?: string;
  count?: number;
  count_fp?: string;
  created_time?: string;
  yes_price?: number;
  no_price?: number;
  yes_price_dollars?: string;
  no_price_dollars?: string;
};

/** Trades strictly newer than sinceSec, oldest-first. Max 4 pages. */
async function fetchNewTrades(ticker: string, sinceSec: number) {
  const out: Trade[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const url =
      `${KALSHI}/markets/trades?ticker=${encodeURIComponent(ticker)}` +
      `&limit=1000&min_ts=${sinceSec}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await kfetch(url, 2);
    if (!res) break;
    const json = (await res.json()) as { trades?: Trade[]; cursor?: string };
    const batch = json.trades ?? [];
    out.push(...batch);
    cursor = json.cursor || undefined;
    if (!cursor || batch.length === 0) break;
  }
  return out;
}

export async function snapshotKalshiBook(): Promise<{
  ok: boolean;
  ticker?: string;
  error?: string;
  added?: number;
}> {
  const market = await findActiveMarket();
  if (!market) return { ok: false, error: "no active market (kalshi unavailable)" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / 900_000) * 900_000).toISOString();

  const { data: existing } = await supabaseAdmin
    .from("kalshi_book_ledger")
    .select("yes_vol, no_vol, yes_cost, no_cost, trade_count, last_trade_ts")
    .eq("ticker", market.ticker)
    .maybeSingle();

  const winStartSec = Math.floor(new Date(windowStart).getTime() / 1000);
  const sinceSec = Math.max(winStartSec, Number(existing?.last_trade_ts ?? 0) || winStartSec);

  const trades = await fetchNewTrades(market.ticker, sinceSec);

  let yesVol = Number(existing?.yes_vol ?? 0) || 0;
  let noVol = Number(existing?.no_vol ?? 0) || 0;
  let yesCost = Number(existing?.yes_cost ?? 0) || 0;
  let noCost = Number(existing?.no_cost ?? 0) || 0;
  let count = Number(existing?.trade_count ?? 0) || 0;
  let maxTs = sinceSec;
  let added = 0;

  for (const t of trades) {
    const ts = t.created_time ? Math.floor(new Date(t.created_time).getTime() / 1000) : NaN;
    if (!Number.isFinite(ts)) continue;
    // min_ts is inclusive on Kalshi's side; skip anything we already counted.
    if (ts <= sinceSec && existing?.last_trade_ts != null) continue;
    if (ts < winStartSec) continue;

    const c = num(t.count_fp ?? t.count) ?? 0;
    if (!(c > 0)) continue;
    const side = String(t.taker_side ?? "").toLowerCase();
    if (side !== "yes" && side !== "no") continue;

    const yesCents =
      t.yes_price_dollars != null ? Number(t.yes_price_dollars) * 100 : num(t.yes_price);
    const noCents =
      t.no_price_dollars != null ? Number(t.no_price_dollars) * 100 : num(t.no_price);

    if (side === "yes") {
      yesVol += c;
      if (yesCents != null) yesCost += (c * yesCents) / 100;
    } else {
      noVol += c;
      if (noCents != null) noCost += (c * noCents) / 100;
    }
    count += 1;
    added += 1;
    if (ts > maxTs) maxTs = ts;
  }

  const totalCollected = yesCost + noCost;
  const yesPayout = yesVol; // $1 per winning contract
  const noPayout = noVol;
  const houseIfYes = totalCollected - yesPayout;
  const houseIfNo = totalCollected - noPayout;

  const row = {
    ticker: market.ticker,
    window_start: windowStart,
    close_time: new Date(market.closeMs).toISOString(),
    strike: market.strike,
    yes_vol: yesVol,
    no_vol: noVol,
    trade_count: count,
    yes_cost: Math.round(yesCost * 100) / 100,
    no_cost: Math.round(noCost * 100) / 100,
    yes_avg_cents: yesVol > 0 ? Math.round((yesCost / yesVol) * 1000) / 10 : null,
    no_avg_cents: noVol > 0 ? Math.round((noCost / noVol) * 1000) / 10 : null,
    yes_payout: yesPayout,
    no_payout: noPayout,
    total_collected: Math.round(totalCollected * 100) / 100,
    house_if_yes: Math.round(houseIfYes * 100) / 100,
    house_if_no: Math.round(houseIfNo * 100) / 100,
    house_lean: houseIfYes === houseIfNo ? null : houseIfYes > houseIfNo ? "YES" : "NO",
    last_trade_ts: maxTs,
    last_seen_at: new Date(nowMs).toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("kalshi_book_ledger")
    .upsert(row, { onConflict: "ticker" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ticker: market.ticker, added };
}

/** Ask Kalshi directly how a (closed) market resolved. */
async function kalshiResult(ticker: string): Promise<"YES" | "NO" | null> {
  const res = await kfetch(`${KALSHI}/markets/${encodeURIComponent(ticker)}`, 2);
  if (!res) return null;
  const json = (await res.json()) as { market?: { result?: string; status?: string } };
  const r = String(json.market?.result ?? "").toLowerCase();
  if (r === "yes") return "YES";
  if (r === "no") return "NO";
  return null;
}

/** Backfill outcome + realized house P/L for closed windows. */
export async function settleKalshiBook(): Promise<{ settled: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pending } = await supabaseAdmin
    .from("kalshi_book_ledger")
    .select("ticker, house_if_yes, house_if_no")
    .is("outcome", null)
    .lt("close_time", new Date(Date.now() - 60_000).toISOString())
    .order("close_time", { ascending: false })
    .limit(50);
  if (!pending?.length) return { settled: 0 };

  const tickers = pending.map((p: { ticker: string }) => p.ticker);
  const { data: preds } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, outcome")
    .in("ticker", tickers)
    .not("outcome", "is", null);
  const outcomeBy = new Map<string, string>(
    ((preds ?? []) as Array<{ ticker: string; outcome: string }>).map((p) => [p.ticker, p.outcome]),
  );

  let settled = 0;
  for (const p of pending as Array<{
    ticker: string;
    house_if_yes: number | null;
    house_if_no: number | null;
  }>) {
    let o = outcomeBy.get(p.ticker);
    // Fallback: our prediction row can be missing (rate-limit gaps). Kalshi
    // itself always knows how the market resolved, so a closed window never
    // stays blank in the ledger.
    if (o !== "YES" && o !== "NO") o = (await kalshiResult(p.ticker)) ?? undefined;
    if (o !== "YES" && o !== "NO") continue;
    const pnl = o === "YES" ? p.house_if_yes : p.house_if_no;
    const { error } = await supabaseAdmin
      .from("kalshi_book_ledger")
      .update({ outcome: o, house_pnl: pnl, settled_at: new Date().toISOString() })
      .eq("ticker", p.ticker);
    if (!error) settled += 1;
  }
  return { settled };
}
