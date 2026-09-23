// 4/4 Agreement Auto-Bet — REAL MONEY.
//
// Fires only when all four legs (odds · volume · model · study) have agreed on
// the same side for at least 90 consecutive seconds inside the current 15m
// window, confirmed server-side from the recorded agreement log (not from a
// single browser-reported hold number).
//
// Price cap is split by time left: 70c while more than 5 minutes remain,
// 90c inside the last 5 minutes.
//
// One buy per (user, window) shared with every other engine. $100 flat unless
// the user changed the stake. Touches no other engine's logic.

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const DEFAULT_STAKE_CENTS = 10000; // $100 flat
const MIN_SECONDS_TO_CLOSE = 60;
const HOLD_SECONDS = 90;
const LATE_SECONDS = 300; // last 5 minutes
const EARLY_MAX_ASK_CENTS = 70;
const LATE_MAX_ASK_CENTS = 90;
const MAX_SAMPLE_AGE_SEC = 45; // the log is written every 10s by the live page

type Side = "UP" | "DOWN";

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

export interface AgreementTickResult {
  side: Side | null;
  heldSeconds: number;
  held: boolean;
  capCents: number | null;
  ticker: string | null;
  users: number;
  fired: number;
  results: Array<{ userId: string; reason: string; fired: boolean; askCents?: number | null }>;
}

export async function driveAgreementBet(): Promise<AgreementTickResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / 900_000) * 900_000;
  const closeMs = windowStart + 900_000;
  const secondsToClose = Math.round((closeMs - nowMs) / 1000);

  const out: AgreementTickResult = {
    side: null,
    heldSeconds: 0,
    held: false,
    capCents: null,
    ticker: null,
    users: 0,
    fired: 0,
    results: [],
  };

  if (secondsToClose <= MIN_SECONDS_TO_CLOSE) return out;

  // Recent agreement samples for this window, newest first.
  const { data: rows } = await supabaseAdmin
    .from("btc_agreement_log")
    .select("bucket_sec, all_four, agreed_side, created_at")
    .eq("window_start", new Date(windowStart).toISOString())
    .order("bucket_sec", { ascending: false })
    .limit(40);
  const samples = (rows ?? []) as Array<{
    bucket_sec: number;
    all_four: boolean | null;
    agreed_side: Side | null;
    created_at: string;
  }>;
  const latest = samples[0];
  if (!latest || !latest.all_four || !latest.agreed_side) return out;

  // The log must be fresh — a stale page leaves old rows behind.
  const ageSec = (nowMs - new Date(latest.created_at).getTime()) / 1000;
  if (ageSec > MAX_SAMPLE_AGE_SEC) return out;

  const side: Side = latest.agreed_side;
  out.side = side;

  // Walk back while the samples stay 4/4 on the same side and the 10s buckets
  // are contiguous; that span is the server-confirmed hold.
  let holdStart = latest.bucket_sec;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    const prev = samples[i - 1]!;
    if (prev.bucket_sec - s.bucket_sec > 20) break; // gap in recording
    if (!s.all_four || s.agreed_side !== side) break;
    holdStart = s.bucket_sec;
  }
  const heldSeconds = Math.max(0, latest.bucket_sec - holdStart) + Math.floor(ageSec);
  out.heldSeconds = heldSeconds;
  out.held = heldSeconds >= HOLD_SECONDS;
  if (!out.held) return out;

  const kalshiSide: "YES" | "NO" = side === "UP" ? "YES" : "NO";
  const capCents = secondsToClose <= LATE_SECONDS ? LATE_MAX_ASK_CENTS : EARLY_MAX_ASK_CENTS;
  out.capCents = capCents;

  // The open window this agreement belongs to.
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
      "id, agreement_bet_stake_cents, agreement_bet_enabled_at, agreement_bet_live_enabled, kalshi_api_key_id, kalshi_private_key_pem",
    )
    .eq("agreement_bet_enabled", true)
    .limit(200);
  const userRows = (users ?? []) as Array<{
    id: string;
    agreement_bet_stake_cents: number | null;
    agreement_bet_enabled_at: string | null;
    agreement_bet_live_enabled: boolean | null;
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
    .select("user_id")
    .eq("ticker", w.ticker);
  const { data: paper } = await supabaseAdmin
    .from("paper_fills")
    .select("user_id")
    .eq("ticker", w.ticker);
  const already = new Set<string>([
    ...((live ?? []) as Array<{ user_id: string }>).map((r) => String(r.user_id)),
    ...((paper ?? []) as Array<{ user_id: string }>).map((r) => String(r.user_id)),
  ]);

  const askCents = await fetchKalshiAskCents(w.ticker, kalshiSide);

  for (const u of userRows) {
    if (already.has(u.id)) {
      out.results.push({ userId: u.id, reason: "window_already_bought", fired: false });
      continue;
    }
    if (dailyLossStopHit(lossCounts, u.id)) {
      out.results.push({ userId: u.id, reason: "daily_loss_stop", fired: false });
      continue;
    }
    if (u.agreement_bet_enabled_at && windowStart < new Date(u.agreement_bet_enabled_at).getTime()) {
      out.results.push({ userId: u.id, reason: "armed_mid_window", fired: false });
      continue;
    }
    if (!u.agreement_bet_live_enabled) {
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
    if (askCents > capCents) {
      out.results.push({ userId: u.id, reason: `above_${capCents}c`, fired: false, askCents });
      continue;
    }

    const stakeCents = Math.max(
      100,
      Math.min(50000, Number(u.agreement_bet_stake_cents) || DEFAULT_STAKE_CENTS),
    );
    const contracts = Math.max(1, Math.floor(stakeCents / askCents));
    try {
      const { submitKalshiBuy } = await import("./cryptoTrades.functions");
      const result = await submitKalshiBuy(supabaseAdmin, u.id, {
        ticker: w.ticker,
        side: kalshiSide,
        contracts,
        limitPriceCents: askCents,
        strike: w.strike ?? undefined,
        closeTime: w.close_time,
        stakeUsd: stakeCents / 100,
        inputsSnapshot: {
          source: "agreement_bet",
          agreed_side: side,
          held_seconds: heldSeconds,
          ask_cents: askCents,
          cap_cents: capCents,
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
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      out.results.push({ userId: u.id, reason: `live_error:${msg}`, fired: false, askCents });
    }
  }

  return out;
}
