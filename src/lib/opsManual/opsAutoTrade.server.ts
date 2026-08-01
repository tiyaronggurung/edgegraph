// Ops Manual Auto-Trade (REAL MONEY).
//
// Fires at most ONE Kalshi IOC buy per (user, ticker) and only when EVERY
// rule in src/lib/opsManual/rules.ts passes. This module is deliberately the
// only auto path that uses the Operating-Manual stake (a % of the morning
// bankroll) — it does not touch the $10-flat auto-trade paths.
//
// Order of gates (a failure at any step logs a skip and returns):
//   1. user toggle + Kalshi keys
//   2. trading day opened (morning bankroll fixed)  -> ops_daily_snapshots
//   3. session stops: Sunday, 4 bets, 2 consecutive losses, ±20% day
//   4. staking mode is not "disabled" (kill switch / violations / status)
//   5. per-window qualification: T7 lock, conf ≥ 90%, cushion ≥ $40,
//      ask ≤ 80¢, model agrees with study, ≥ 2m left, hour allowed
//   6. idempotency: no existing ops_trades row for (user, ticker)
//
// Every fired order is written to ops_trades with source='ops_auto' so the
// Operating-Manual ledger, discipline score and P/L stay the single truth.

import {
  OPS_RULES,
  computeStakingMode,
  computeStatus,
  disciplineScore,
  evaluateDailyStops,
  evaluateQualification,
  round2,
} from "./rules";
import { summarizeLedger, type LedgerTrade } from "./opsManual.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const SEED_BANKROLL = 1000;
const LOOKAHEAD_MS = 16 * 60 * 1000;

export interface OpsAutoAttempt {
  ticker: string;
  fired: boolean;
  reason: string;
  askCents?: number | null;
  cushionUsd?: number | null;
  stake?: number;
  failReasons?: string[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchAskCents(ticker: string, side: "YES" | "NO"): Promise<number | null> {
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
      typeof m.yes_bid === "number" ? m.yes_bid : m.yes_bid_dollars != null ? Math.round(Number(m.yes_bid_dollars) * 100) : NaN;
    const yesAsk =
      typeof m.yes_ask === "number" ? m.yes_ask : m.yes_ask_dollars != null ? Math.round(Number(m.yes_ask_dollars) * 100) : NaN;
    if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk)) return null;
    const cents = side === "YES" ? yesAsk : 100 - yesBid;
    return Math.max(1, Math.min(99, Math.round(cents)));
  } catch {
    return null;
  }
}

async function latestSpot(db: SB): Promise<number | null> {
  const { data } = await db
    .from("btc_spot_ticks")
    .select("spot, observed_at")
    .order("observed_at", { ascending: false })
    .limit(1);
  const s = data?.[0]?.spot;
  return s != null && Number.isFinite(Number(s)) ? Number(s) : null;
}

async function logSkip(
  db: SB,
  userId: string,
  ticker: string,
  closeTime: string | null,
  strike: number | null,
  side: string | null,
  askCents: number | null,
  secondsLeft: number | null,
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
      seconds_to_close: secondsLeft,
      skip_reason: `ops_auto:${reason}`,
    });
  } catch {
    /* noop */
  }
}

/** Current session state derived exactly like the Ops dashboard does. */
export async function loadOpsSessionState(db: SB, userId: string) {
  const session_date = todayUtc();
  const [tradesRes, snapRes, wdRes, violRes] = await Promise.all([
    db.from("ops_trades").select("*").eq("user_id", userId).order("decision_at", { ascending: false }).limit(1000),
    db.from("ops_daily_snapshots").select("*").eq("user_id", userId).eq("session_date", session_date).maybeSingle(),
    db.from("ops_withdrawals").select("withdrawn_amount").eq("user_id", userId),
    db.from("ops_rule_violations").select("occurred_at, session_date").eq("user_id", userId).limit(200),
  ]);

  const trades = (tradesRes.data ?? []) as LedgerTrade[];
  const withdrawn = (wdRes.data ?? []).reduce((s: number, w: { withdrawn_amount: number }) => s + Number(w.withdrawn_amount || 0), 0);
  const summary = summarizeLedger(trades, SEED_BANKROLL, withdrawn);

  const violations = (violRes.data ?? []) as Array<{ occurred_at: string; session_date: string }>;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weeklyViolations = violations.filter((v) => Date.parse(v.occurred_at) >= weekAgo).length;

  const status = computeStatus({
    rolling30Wr: summary.rolling30Wr,
    rolling100Wr: summary.rolling100Wr,
    drawdownPct: summary.drawdownPct / 100,
    settled100: summary.totalWins + summary.totalLosses,
  });

  const snapshot = snapRes.data as null | { morning_bankroll: number };
  const dayOpened = !!snapshot;
  const morningBankroll = snapshot ? Number(snapshot.morning_bankroll) : summary.currentBankroll - withdrawn;

  const stakingRaw = computeStakingMode({
    morningBankroll,
    status: status.status,
    weeklyViolations,
  });
  const staking =
    stakingRaw.mode === "disabled" ? stakingRaw : { ...stakingRaw, unitUsd: round2(morningBankroll * stakingRaw.unitPct) };

  const todayTrades = trades.filter((t) => t.session_date === session_date);
  const todaySettled = todayTrades
    .filter((t) => t.result === "win" || t.result === "loss")
    .sort((a, b) => Date.parse(a.decision_at) - Date.parse(b.decision_at));
  let consec = 0;
  for (let i = todaySettled.length - 1; i >= 0; i--) {
    if (todaySettled[i].result === "loss") consec++;
    else break;
  }
  const dailyPnl = round2(todaySettled.reduce((s, t) => s + (t.realized_pnl ?? 0), 0));
  const isSunday = new Date().getUTCDay() === 0;

  const stops = evaluateDailyStops({
    betsPlaced: todayTrades.length,
    consecutiveLosses: consec,
    dailyPnl,
    morningBankroll,
    ruleViolationToday: violations.some((v) => v.session_date === session_date),
    isSunday,
  });

  return { sessionDate: session_date, summary, status, staking, morningBankroll, dayOpened, stops, consec, dailyPnl, isSunday, weeklyViolations, todayTrades };
}

/**
 * Evaluate every open, T7-locked window for one user and fire at most one
 * qualifying order. Returns the attempt log (also used by the UI preview).
 */
export async function runOpsAutoTradeForUser(
  userId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ ok: boolean; fired: number; reason?: string; attempts: OpsAutoAttempt[] }> {
  const dryRun = opts.dryRun === true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db: SB = supabaseAdmin;

  // 1) toggle + keys
  const { data: profile } = await db
    .from("profiles")
    .select("ops_auto_trade_enabled, kalshi_api_key_id, kalshi_private_key_pem")
    .eq("id", userId)
    .maybeSingle();
  if (!dryRun && !profile?.ops_auto_trade_enabled) return { ok: true, fired: 0, reason: "toggle_off", attempts: [] };
  if (!profile?.kalshi_api_key_id || !profile?.kalshi_private_key_pem) {
    return { ok: true, fired: 0, reason: "no_keys", attempts: [] };
  }

  // 2-4) session gates
  const s = await loadOpsSessionState(db, userId);
  if (!s.dayOpened) return { ok: true, fired: 0, reason: "day_not_opened", attempts: [] };
  if (s.stops.stopped) return { ok: true, fired: 0, reason: `session_stopped:${s.stops.stopReason ?? "stop"}`, attempts: [] };
  if (s.staking.mode === "disabled") return { ok: true, fired: 0, reason: `staking_disabled:${s.staking.reason}`, attempts: [] };
  if (s.stops.betsRemaining <= 0) return { ok: true, fired: 0, reason: "daily_bet_limit", attempts: [] };

  const stake = s.staking.unitUsd;
  if (!(stake > 0)) return { ok: true, fired: 0, reason: "zero_unit", attempts: [] };

  // 5) candidate windows — T7 locked, still open, at least MIN_SECONDS_LEFT
  const nowMs = Date.now();
  const { data: preds } = await db
    .from("btc_model_predictions")
    .select(
      "ticker, close_time, strike, side, model_side_pre_study, model_prob, study_locked_side, study_lock_confidence, study_locked_at, spot_at_snapshot",
    )
    .not("study_locked_side", "is", null)
    .gt("close_time", new Date(nowMs + OPS_RULES.MIN_SECONDS_LEFT * 1000).toISOString())
    .lt("close_time", new Date(nowMs + LOOKAHEAD_MS).toISOString())
    .order("close_time", { ascending: true })
    .limit(5);

  const attempts: OpsAutoAttempt[] = [];
  if (!preds || preds.length === 0) return { ok: true, fired: 0, reason: "no_locked_window", attempts };

  const spot = await latestSpot(db);
  let fired = 0;

  for (const p of preds as Array<Record<string, unknown>>) {
    const ticker = String(p.ticker);
    const closeTime = String(p.close_time);
    const strike = p.strike != null ? Number(p.strike) : null;
    const studySide = p.study_locked_side ? String(p.study_locked_side).toUpperCase() : null;
    const modelSide = String((p.model_side_pre_study ?? p.side ?? "") || "").toUpperCase() || null;
    const studyConf = p.study_lock_confidence != null ? Number(p.study_lock_confidence) : null;
    const modelConf = p.model_prob != null ? Number(p.model_prob) * 100 : null;
    const secondsLeft = Math.round((Date.parse(closeTime) - Date.now()) / 1000);
    const refSpot = spot ?? (p.spot_at_snapshot != null ? Number(p.spot_at_snapshot) : null);
    const cushionUsd = refSpot != null && strike != null ? Math.abs(refSpot - strike) : null;

    // idempotency first (cheap)
    const { data: existing } = await db
      .from("ops_trades")
      .select("id")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .limit(1);
    if (existing && existing.length > 0) {
      attempts.push({ ticker, fired: false, reason: "already_traded" });
      continue;
    }

    const askCents = studySide === "YES" || studySide === "NO" ? await fetchAskCents(ticker, studySide) : null;

    const q = evaluateQualification({
      hasT7Lock: !!studySide,
      studyConfPct: studyConf,
      cushionUsd,
      askCents,
      modelSide,
      studySide,
      secondsLeft,
      utcHour: new Date().getUTCHours(),
    });

    if (!q.qualified) {
      attempts.push({ ticker, fired: false, reason: `not_qualified:${q.failReasons.join(",")}`, askCents, cushionUsd, failReasons: q.failReasons });
      if (!dryRun) await logSkip(db, userId, ticker, closeTime, strike, studySide, askCents, secondsLeft, q.failReasons.join("+"));
      continue;
    }

    if (dryRun) {
      attempts.push({ ticker, fired: false, reason: "would_fire", askCents, cushionUsd, stake });
      continue;
    }

    // 6) fire — IOC buy at the current ask, sized to the Operating-Manual unit
    const ask = askCents as number;
    const contracts = Math.max(1, Math.floor((stake * 100) / ask));
    const { submitKalshiBuy } = await import("../cryptoTrades.functions");
    try {
      const result = await submitKalshiBuy(db, userId, {
        ticker,
        side: studySide as "YES" | "NO",
        contracts,
        limitPriceCents: ask,
        strike: strike as number,
        closeTime,
        stakeUsd: round2((contracts * ask) / 100),
        inputsSnapshot: {
          source: "ops_auto_trade",
          locked_side: studySide,
          study_conf_pct: studyConf,
          cushion_usd: cushionUsd,
          ask_cents: ask,
          seconds_to_close: secondsLeft,
          unit_pct: s.staking.unitPct,
          morning_bankroll: s.morningBankroll,
          fired_at: new Date().toISOString(),
        },
      });

      if (result.fillCount <= 0) {
        attempts.push({ ticker, fired: false, reason: "unfilled", askCents: ask, cushionUsd, stake });
        await logSkip(db, userId, ticker, closeTime, strike, studySide, ask, secondsLeft, "unfilled");
        continue;
      }

      const filledStake = round2(result.filledCents / 100);
      await db.from("ops_trades").insert({
        user_id: userId,
        session_date: s.sessionDate,
        ticker,
        utc_hour: new Date().getUTCHours(),
        strike,
        side: studySide,
        study_side: studySide,
        study_conf: studyConf,
        model_side: modelSide,
        model_conf: modelConf,
        spot_at_lock: refSpot,
        cushion_usd: cushionUsd,
        ask_cents: ask,
        seconds_left: secondsLeft,
        stake: filledStake,
        potential_profit: round2(filledStake * ((100 - ask) / ask)),
        rule_status: "compliant",
        violations: [],
        discipline_score: disciplineScore([]),
        source: "ops_auto",
        contracts: result.fillCount,
        kalshi_order_id: result.orderId,
        crypto_trade_id: result.tradeId,
        notes: "Auto-fired by Ops Manual auto-trader",
        decision_snapshot: {
          capturedAt: new Date().toISOString(),
          filters: q.filters,
          qualified: true,
          preferredHour: q.preferredHour,
          stakingMode: s.staking.mode,
          unitUsd: stake,
          morningBankroll: s.morningBankroll,
          autoTrade: true,
        },
      });

      fired++;
      attempts.push({ ticker, fired: true, reason: "filled", askCents: ask, cushionUsd, stake: filledStake });
      break; // one bet per tick — never stack windows
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ ticker, fired: false, reason: `error:${msg.slice(0, 120)}`, askCents: ask, cushionUsd });
      await logSkip(db, userId, ticker, closeTime, strike, studySide, ask, secondsLeft, `error:${msg.slice(0, 100)}`);
    }
  }

  return { ok: true, fired, attempts };
}

/**
 * Settle any open ops_auto trades whose window has an outcome. Win pays
 * (100-ask)/ask per $ staked, loss forfeits the stake.
 */
export async function settleOpsAutoTrades(): Promise<{ settled: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db: SB = supabaseAdmin;

  const { data: open } = await db
    .from("ops_trades")
    .select("id, user_id, ticker, side, stake, ask_cents")
    .eq("source", "ops_auto")
    .is("result", null)
    .limit(50);
  if (!open || open.length === 0) return { settled: 0 };

  const tickers = open.map((t: { ticker: string }) => t.ticker);
  const { data: preds } = await db
    .from("btc_model_predictions")
    .select("ticker, outcome")
    .in("ticker", tickers)
    .not("outcome", "is", null);
  const outcomeOf = new Map<string, string>((preds ?? []).map((p: { ticker: string; outcome: string }) => [p.ticker, String(p.outcome).toUpperCase()]));

  let settled = 0;
  for (const t of open as Array<{ id: string; ticker: string; side: string | null; stake: number; ask_cents: number | null }>) {
    const outcome = outcomeOf.get(t.ticker);
    if (!outcome || (outcome !== "YES" && outcome !== "NO")) continue;
    const won = (t.side ?? "").toUpperCase() === outcome;
    const ask = t.ask_cents ?? 0;
    const pnl = won && ask > 0 ? round2(Number(t.stake) * ((100 - ask) / ask)) : -round2(Number(t.stake));
    await db.from("ops_trades").update({ result: won ? "win" : "loss", realized_pnl: pnl }).eq("id", t.id);
    settled++;
  }
  return { settled };
}

/** Cron driver: every enabled user, one pass. */
export async function driveOpsAutoTrade(): Promise<{
  users: number;
  fired: number;
  results: Array<{ userId: string; fired: number; reason?: string; attempts: OpsAutoAttempt[] }>;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db: SB = supabaseAdmin;

  await settleOpsAutoTrades();

  const { data: users } = await db
    .from("profiles")
    .select("id")
    .eq("ops_auto_trade_enabled", true)
    .not("kalshi_api_key_id", "is", null)
    .not("kalshi_private_key_pem", "is", null)
    .limit(50);

  const ids = (users ?? []).map((u: { id: string }) => u.id);
  const results: Array<{ userId: string; fired: number; reason?: string; attempts: OpsAutoAttempt[] }> = [];
  let fired = 0;
  for (const userId of ids) {
    try {
      const r = await runOpsAutoTradeForUser(userId);
      fired += r.fired;
      results.push({ userId, fired: r.fired, reason: r.reason, attempts: r.attempts });
    } catch (e) {
      results.push({ userId, fired: 0, reason: `throw:${e instanceof Error ? e.message : String(e)}`, attempts: [] });
    }
  }
  return { users: ids.length, fired, results };
}
