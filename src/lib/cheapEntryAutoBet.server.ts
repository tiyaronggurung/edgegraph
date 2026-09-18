// Cheap Entry Auto-Bet — PAPER ONLY.
//
// Separate from studyAutoLive (real money, fires once at the T-7 lock).
// This engine watches every open BTC 15m window and buys the first moment the
// target side's Kalshi ask sits inside the 20-65c band:
//
//   1) window has a Study lock  -> target = study side, from lock until T-60s
//   2) no Study lock, T<=8min   -> target = model side  (fallback)
//
// One buy per (user, ticker) ever. Writes paper_fills with button='manual' and
// entry_snapshot.source='cheap_entry' so it stays out of Model/PRED/Green Hours
// stats, exactly like the study_auto paper path.
//
// Nothing here touches studyAutoLive, chipStudyPick, the model, the Study lock,
// trendlines, or any exit path.

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const DEFAULT_STAKE_CENTS = 1000;

export const MIN_ASK_CENTS = 20;   // sub-20c fills are a mirage
export const MAX_ASK_CENTS = 65;   // the backtested cheap band
const MIN_SECONDS_TO_CLOSE = 60;   // never buy inside the last minute
const MODEL_FALLBACK_MAX_SECONDS = 8 * 60; // model side only inside T-8min

export type CheapEntrySource = "study" | "model";

async function fetchKalshiAskCents(ticker: string, side: "YES" | "NO"): Promise<number | null> {
  try {
    const res = await fetch(`${KALSHI}/markets/${encodeURIComponent(ticker)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      market?: { yes_bid?: number; yes_ask?: number; yes_bid_dollars?: string; yes_ask_dollars?: string };
    };
    const m = j.market;
    if (!m) return null;
    const yesBid = typeof m.yes_bid === "number"
      ? m.yes_bid
      : (m.yes_bid_dollars != null ? Math.round(Number(m.yes_bid_dollars) * 100) : NaN);
    const yesAsk = typeof m.yes_ask === "number"
      ? m.yes_ask
      : (m.yes_ask_dollars != null ? Math.round(Number(m.yes_ask_dollars) * 100) : NaN);
    if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk)) return null;
    if (side === "YES") return Math.max(1, Math.min(99, Math.round(yesAsk)));
    return Math.max(1, Math.min(99, Math.round(100 - yesBid)));
  } catch {
    return null;
  }
}

async function logSkip(
  db: any,
  userId: string,
  ticker: string,
  closeTime: string,
  strike: number | null,
  side: string,
  askCents: number | null,
  secondsToClose: number,
  reason: string,
) {
  try {
    await db.from("auto_trade_skip_log").insert({
      user_id: userId,
      ticker,
      close_time: closeTime,
      side,
      strike,
      ask_price: askCents != null ? askCents / 100 : null,
      seconds_to_close: secondsToClose,
      skip_reason: `cheap_entry:${reason}`,
    });
  } catch { /* noop */ }
}

interface WindowRow {
  ticker: string;
  close_time: string;
  strike: number | null;
  side: string | null;
  study_locked_side: string | null;
  study_locked_at: string | null;
}

/** Decide the target side + source for one window, or null when it doesn't qualify yet. */
export function pickTarget(
  w: WindowRow,
  secondsToClose: number,
): { side: "YES" | "NO"; source: CheapEntrySource } | { skip: string } {
  if (secondsToClose <= MIN_SECONDS_TO_CLOSE) return { skip: "too_late" };

  if (w.study_locked_side === "YES" || w.study_locked_side === "NO") {
    return { side: w.study_locked_side, source: "study" };
  }
  if (secondsToClose > MODEL_FALLBACK_MAX_SECONDS) return { skip: "waiting_for_study_lock" };
  if (w.side === "YES" || w.side === "NO") return { side: w.side, source: "model" };
  return { skip: "no_side" };
}

export interface CheapEntryTickResult {
  users: number;
  windows: number;
  attempts: number;
  fired: number;
  settled: number;
  results: Array<{ userId: string; ticker: string; reason: string; fired: boolean; askCents?: number | null }>;
}

export async function driveCheapEntry(): Promise<CheapEntryTickResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowMs = Date.now();
  const { data: windows } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, close_time, strike, side, study_locked_side, study_locked_at")
    .gt("close_time", new Date(nowMs + MIN_SECONDS_TO_CLOSE * 1000).toISOString())
    .lt("close_time", new Date(nowMs + 20 * 60 * 1000).toISOString())
    .order("close_time", { ascending: true })
    .limit(10);

  const openWindows = (windows ?? []) as unknown as WindowRow[];

  const { data: users } = await supabaseAdmin
    .from("profiles")
    .select("id, cheap_entry_stake_cents, cheap_entry_enabled_at, cheap_entry_live_enabled, kalshi_api_key_id, kalshi_private_key_pem")
    .eq("cheap_entry_enabled", true)
    .limit(200);
  const userRows = (users ?? []) as Array<{
    id: string;
    cheap_entry_stake_cents: number | null;
    cheap_entry_enabled_at: string | null;
    cheap_entry_live_enabled: boolean | null;
    kalshi_api_key_id: string | null;
    kalshi_private_key_pem: string | null;
  }>;

  const out: CheapEntryTickResult = {
    users: userRows.length,
    windows: openWindows.length,
    attempts: 0,
    fired: 0,
    settled: 0,
    results: [],
  };

  if (userRows.length && openWindows.length) {
    // Already-fired markers for these tickers (idempotency, one query).
    const tickers = openWindows.map((w) => w.ticker);
    const { data: existing } = await supabaseAdmin
      .from("paper_fills")
      .select("user_id, ticker")
      .in("ticker", tickers)
      .filter("entry_snapshot->>source", "eq", "cheap_entry");
    // Live fills live in crypto_trades — check both so one window is never
    // bought twice, even if the live switch was flipped mid-window.
    const { data: existingLive } = await supabaseAdmin
      .from("crypto_trades")
      .select("user_id, ticker")
      .in("ticker", tickers)
      .filter("inputs_snapshot->>source", "eq", "cheap_entry");
    const already = new Set([
      ...((existing ?? []) as any[]).map((r) => `${r.user_id}|${r.ticker}`),
      ...((existingLive ?? []) as any[]).map((r) => `${r.user_id}|${r.ticker}`),
    ]);

    // Ask price per (ticker, side) — fetched once, shared across users.
    const askCache = new Map<string, number | null>();

    for (const w of openWindows) {
      const secondsToClose = Math.round((new Date(w.close_time).getTime() - Date.now()) / 1000);
      const target = pickTarget(w, secondsToClose);
      if ("skip" in target) continue;

      const cacheKey = `${w.ticker}|${target.side}`;
      if (!askCache.has(cacheKey)) {
        askCache.set(cacheKey, await fetchKalshiAskCents(w.ticker, target.side));
      }
      const askCents = askCache.get(cacheKey) ?? null;

      const winStartMs = new Date(w.close_time).getTime() - 15 * 60 * 1000;

      for (const u of userRows) {
        if (already.has(`${u.id}|${w.ticker}`)) continue;
        // Only act on windows that STARTED after the switch was flipped on —
        // enabling mid-window never touches the window already running.
        if (u.cheap_entry_enabled_at && winStartMs < new Date(u.cheap_entry_enabled_at).getTime()) {
          continue;
        }
        out.attempts++;

        if (askCents == null) {
          out.results.push({ userId: u.id, ticker: w.ticker, reason: "no_kalshi_ask", fired: false });
          continue;
        }
        if (askCents < MIN_ASK_CENTS || askCents > MAX_ASK_CENTS) {
          const reason = askCents < MIN_ASK_CENTS ? `below_${MIN_ASK_CENTS}c` : `above_${MAX_ASK_CENTS}c`;
          await logSkip(supabaseAdmin, u.id, w.ticker, w.close_time, w.strike, target.side, askCents, secondsToClose, reason);
          out.results.push({ userId: u.id, ticker: w.ticker, reason, fired: false, askCents });
          continue;
        }

        // Balance + stake
        const { data: bal } = await supabaseAdmin
          .from("paper_balances")
          .select("balance_cents, bankrupt_at")
          .eq("user_id", u.id)
          .maybeSingle();
        if (!bal || bal.bankrupt_at) {
          out.results.push({ userId: u.id, ticker: w.ticker, reason: "no_balance", fired: false, askCents });
          continue;
        }
        const stakeCents = Math.max(100, Math.min(10000, Number(u.cheap_entry_stake_cents) || DEFAULT_STAKE_CENTS));
        if (bal.balance_cents < stakeCents) {
          out.results.push({ userId: u.id, ticker: w.ticker, reason: "insufficient_balance", fired: false, askCents });
          continue;
        }

        const contracts = Math.max(1, Math.floor(stakeCents / askCents));
        const { error: insErr } = await supabaseAdmin.from("paper_fills").insert({
          user_id: u.id,
          ticker: w.ticker,
          close_time: w.close_time,
          button: "manual",
          side: target.side,
          contracts,
          fill_price_cents: askCents,
          stake_cents: stakeCents,
          status: "open",
          entry_snapshot: {
            source: "cheap_entry",
            pick_source: target.source,
            ask_cents: askCents,
            stake_cents: stakeCents,
            seconds_to_close: secondsToClose,
            strike: w.strike,
            fired_at: new Date().toISOString(),
          },
        } as never);
        if (insErr) {
          out.results.push({ userId: u.id, ticker: w.ticker, reason: `insert_err:${insErr.message}`, fired: false, askCents });
          continue;
        }

        await supabaseAdmin
          .from("paper_balances")
          .update({
            balance_cents: bal.balance_cents - stakeCents,
            bankrupt_at: bal.balance_cents - stakeCents <= 0 ? new Date().toISOString() : null,
          })
          .eq("user_id", u.id);

        already.add(`${u.id}|${w.ticker}`);
        out.fired++;
        out.results.push({ userId: u.id, ticker: w.ticker, reason: `fired_${target.source}`, fired: true, askCents });
      }
    }
  }

  out.settled = await settleCheapEntryFills();
  return out;
}

/** Settle due cheap_entry paper fills for every user (same math as settleMyPaperFills). */
export async function settleCheapEntryFills(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: due } = await supabaseAdmin
    .from("paper_fills")
    .select("id,user_id,ticker,side,contracts,stake_cents,close_time")
    .eq("status", "open")
    .lt("close_time", new Date().toISOString())
    .filter("entry_snapshot->>source", "eq", "cheap_entry")
    .limit(50);
  const pending = (due ?? []) as any[];
  if (!pending.length) return 0;

  const tickers = [...new Set(pending.map((o) => o.ticker))];
  const { data: closes } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, settle_price, strike")
    .in("ticker", tickers)
    .not("settle_price", "is", null);
  const settleByTicker = new Map<string, { price: number; strike: number | null }>(
    ((closes ?? []) as any[]).map((c) => [
      c.ticker,
      { price: Number(c.settle_price), strike: c.strike != null ? Number(c.strike) : null },
    ]),
  );

  const { fetchKalshiSettlement } = await import("@/lib/kalshiSettle");
  let settled = 0;

  for (const o of pending) {
    let won: boolean | null = null;
    const k = await fetchKalshiSettlement(o.ticker).catch(() => null);
    if (k && k.finalized && k.result) {
      won = o.side === "YES" ? k.result === "yes" : k.result === "no";
    } else {
      const entry = settleByTicker.get(o.ticker);
      if (!entry || entry.strike == null) continue;
      won = o.side === "YES" ? entry.price >= entry.strike : entry.price < entry.strike;
    }

    const payoutCents = won ? o.contracts * 100 : 0;
    const { error } = await supabaseAdmin
      .from("paper_fills")
      .update({
        status: won ? "won" : "lost",
        payout_cents: payoutCents,
        pnl_cents: payoutCents - o.stake_cents,
        settled_at: new Date().toISOString(),
      })
      .eq("id", o.id)
      .eq("status", "open");
    if (error) continue;

    if (payoutCents > 0) {
      const { data: cur } = await supabaseAdmin
        .from("paper_balances")
        .select("balance_cents,bankrupt_at")
        .eq("user_id", o.user_id)
        .maybeSingle();
      if (cur) {
        const newBal = cur.balance_cents + payoutCents;
        await supabaseAdmin
          .from("paper_balances")
          .update({ balance_cents: newBal, bankrupt_at: newBal > 0 ? null : cur.bankrupt_at })
          .eq("user_id", o.user_id);
      }
    }
    settled++;
  }
  return settled;
}
