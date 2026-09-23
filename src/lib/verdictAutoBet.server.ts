// Verdict Auto-Bet — REAL MONEY only, driven by the 3-signal verdict.
//
// Fires only when the two most recent composite-flow rows for the CURRENT 15m
// window carry the same non-null verdict (that agreement is the server-side
// "hold" — the direction had to stick across two ticks, not blink).
//
// Completely separate from Cheap Entry: it skips any window Cheap Entry
// already bought, and records source='verdict_bet' so Cheap Entry skips its
// windows too. One buy per (user, ticker) ever. $10 flat unless the user
// changed the stake.

import { verdictToKalshiSide, type VerdictSide } from "@/lib/btcVerdict";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const DEFAULT_STAKE_CENTS = 1000;
const MIN_SECONDS_TO_CLOSE = 60;
const MAX_ASK_CENTS = 90; // never pay a near-certainty price

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
    const yesBid =
      typeof m.yes_bid === "number"
        ? m.yes_bid
        : m.yes_bid_dollars != null
          ? Math.round(Number(m.yes_bid_dollars) * 100)
          : NaN;
    const yesAsk =
      typeof m.yes_ask === "number"
        ? m.yes_ask
        : m.yes_ask_dollars != null
          ? Math.round(Number(m.yes_ask_dollars) * 100)
          : NaN;
    if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk)) return null;
    if (side === "YES") return Math.max(1, Math.min(99, Math.round(yesAsk)));
    return Math.max(1, Math.min(99, Math.round(100 - yesBid)));
  } catch {
    return null;
  }
}

export interface VerdictTickResult {
  verdict: VerdictSide;
  held: boolean;
  ticker: string | null;
  users: number;
  fired: number;
  results: Array<{ userId: string; reason: string; fired: boolean; askCents?: number | null }>;
}

export async function driveVerdictBet(): Promise<VerdictTickResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / 900_000) * 900_000;
  const closeMs = windowStart + 900_000;
  const secondsToClose = Math.round((closeMs - nowMs) / 1000);

  const out: VerdictTickResult = {
    verdict: null,
    held: false,
    ticker: null,
    users: 0,
    fired: 0,
    results: [],
  };

  if (secondsToClose <= MIN_SECONDS_TO_CLOSE) return out;

  // Two most recent recorded verdicts for this window.
  const { data: rows } = await supabaseAdmin
    .from("btc_composite_flow_log")
    .select("verdict, recorded_at")
    .eq("window_start", new Date(windowStart).toISOString())
    .order("recorded_at", { ascending: false })
    .limit(2);
  const recent = (rows ?? []) as Array<{ verdict: string | null }>;
  const latest = (recent[0]?.verdict ?? null) as VerdictSide;
  const prev = (recent[1]?.verdict ?? null) as VerdictSide;
  out.verdict = latest;
  out.held = latest != null && latest === prev;
  if (!out.held) return out;

  const side = verdictToKalshiSide(latest);
  if (!side) return out;

  // The open window this verdict belongs to.
  const { data: winRow } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, close_time, strike")
    .gt("close_time", new Date(nowMs + MIN_SECONDS_TO_CLOSE * 1000).toISOString())
    .lte("close_time", new Date(closeMs + 1000).toISOString())
    .order("close_time", { ascending: true })
    .limit(1)
    .maybeSingle();
  const w = winRow as { ticker: string; close_time: string; strike: number | null } | null;
  if (!w) return out;
  out.ticker = w.ticker;

  const { data: users } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, verdict_bet_stake_cents, verdict_bet_enabled_at, verdict_bet_live_enabled, kalshi_api_key_id, kalshi_private_key_pem",
    )
    .eq("verdict_bet_enabled", true)
    .limit(200);
  const userRows = (users ?? []) as Array<{
    id: string;
    verdict_bet_stake_cents: number | null;
    verdict_bet_enabled_at: string | null;
    verdict_bet_live_enabled: boolean | null;
    kalshi_api_key_id: string | null;
    kalshi_private_key_pem: string | null;
  }>;
  out.users = userRows.length;
  if (!userRows.length) return out;

  // Daily loss stop: 3 settled real-money losses today (NY day) = done for the day.
  const { getDailyLossCounts, dailyLossStopHit } = await import("./dailyLossGuard.server");
  const lossCounts = await getDailyLossCounts(supabaseAdmin as never);

  // Any engine that already bought this window blocks another buy.
  const { data: live } = await supabaseAdmin
    .from("crypto_trades")
    .select("user_id, inputs_snapshot")
    .eq("ticker", w.ticker);
  const { data: paper } = await supabaseAdmin
    .from("paper_fills")
    .select("user_id")
    .eq("ticker", w.ticker);
  const already = new Set<string>([
    ...((live ?? []) as any[]).map((r) => String(r.user_id)),
    ...((paper ?? []) as any[]).map((r) => String(r.user_id)),
  ]);

  const askCents = await fetchKalshiAskCents(w.ticker, side);

  for (const u of userRows) {
    if (already.has(u.id)) {
      out.results.push({ userId: u.id, reason: "window_already_bought", fired: false });
      continue;
    }
    if (dailyLossStopHit(lossCounts, u.id)) {
      out.results.push({ userId: u.id, reason: "daily_loss_stop", fired: false });
      continue;
    }
    if (u.verdict_bet_enabled_at && windowStart < new Date(u.verdict_bet_enabled_at).getTime()) {
      out.results.push({ userId: u.id, reason: "armed_mid_window", fired: false });
      continue;
    }
    if (!u.verdict_bet_live_enabled) {
      out.results.push({ userId: u.id, reason: "live_switch_off", fired: false });
      continue;
    }
    if (!u.kalshi_api_key_id || !u.kalshi_private_key_pem) {
      out.results.push({ userId: u.id, reason: "no_keys", fired: false });
      continue;
    }
    if (askCents == null) {
      out.results.push({ userId: u.id, reason: "no_kalshi_ask", fired: false });
      continue;
    }
    if (askCents > MAX_ASK_CENTS) {
      out.results.push({ userId: u.id, reason: `above_${MAX_ASK_CENTS}c`, fired: false, askCents });
      continue;
    }

    const stakeCents = Math.max(100, Math.min(10000, Number(u.verdict_bet_stake_cents) || DEFAULT_STAKE_CENTS));
    const contracts = Math.max(1, Math.floor(stakeCents / askCents));
    try {
      const { submitKalshiBuy } = await import("./cryptoTrades.functions");
      const result = await submitKalshiBuy(supabaseAdmin, u.id, {
        ticker: w.ticker,
        side,
        contracts,
        limitPriceCents: askCents,
        strike: w.strike ?? undefined,
        closeTime: w.close_time,
        stakeUsd: stakeCents / 100,
        inputsSnapshot: {
          source: "verdict_bet",
          verdict: latest,
          ask_cents: askCents,
          stake_cents: stakeCents,
          seconds_to_close: secondsToClose,
          strike: w.strike,
          fired_at: new Date().toISOString(),
        },
      } as never);
      already.add(u.id);
      if (result.fillCount > 0) {
        out.fired++;
        out.results.push({ userId: u.id, reason: "fired_live", fired: true, askCents });
      } else {
        out.results.push({ userId: u.id, reason: "live_unfilled", fired: false, askCents });
      }
    } catch (e: any) {
      const msg = (e?.message ?? String(e)).slice(0, 120);
      out.results.push({ userId: u.id, reason: `live_error:${msg}`, fired: false, askCents });
    }
  }

  return out;
}
