// Server-only core for Study Pick Auto-Bet (real money).
// Shared by the auth'd server fn (client tab retry) and the pg_cron driver
// (fires when the tab is closed). Same eligibility, price gate, idempotency,
// sizing, and Kalshi submission — one code path.

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const STAKE_CENTS = 1000;
const MAX_ASK_CENTS = 70; // hard cap: the 70-85c band lost money over 45 days
const MAX_LOCK_AGE_SEC = 60; // fire AT the T7 lock, never chase it 90s later
const MIN_SECONDS_TO_CLOSE = 60;

export type FireResult =
  | { ok: true; fired: false; reason: string; askCents?: number | null; secondsToClose?: number }
  | { ok: true; fired: true; reason: "filled"; askCents: number; contracts: number; fillCount: number; filledCents: number; tradeId: string; orderId: string | null; secondsToClose: number }
  | { ok: false; fired: false; reason: "error"; error: string; askCents?: number | null; secondsToClose?: number };

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
    const yesBid = typeof m.yes_bid === "number" ? m.yes_bid : (m.yes_bid_dollars != null ? Math.round(Number(m.yes_bid_dollars) * 100) : NaN);
    const yesAsk = typeof m.yes_ask === "number" ? m.yes_ask : (m.yes_ask_dollars != null ? Math.round(Number(m.yes_ask_dollars) * 100) : NaN);
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
  strike: number,
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
      skip_reason: `study_auto_live:${reason}`,
    });
  } catch { /* noop */ }
}

// Fire one $10 Kalshi IOC buy for (userId, ticker) if all gates pass.
// Callers: (a) auth'd serverFn from open tab, (b) pg_cron driver.
export async function fireStudyAutoLiveForUser(
  userId: string,
  ticker: string,
): Promise<FireResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) Eligibility
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("study_auto_live_enabled, kalshi_api_key_id, kalshi_private_key_pem, study_auto_stake_cents")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.study_auto_live_enabled) return { ok: true, fired: false, reason: "toggle_off" };
  if (!profile.kalshi_api_key_id || !profile.kalshi_private_key_pem) {
    return { ok: true, fired: false, reason: "no_keys" };
  }

  // 2) Lock + window state
  const { data: pred } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, close_time, strike, study_locked_side, study_lock_kalshi_price_cents, study_auto_live_fired_at, study_locked_at")
    .eq("ticker", ticker)
    .maybeSingle();
  if (!pred?.study_locked_side || !pred.close_time || !pred.strike) {
    return { ok: true, fired: false, reason: "no_lock" };
  }
  if ((pred as any).study_auto_live_fired_at) {
    return { ok: true, fired: false, reason: "already_fired" };
  }
  const secondsToClose = Math.round((new Date(pred.close_time).getTime() - Date.now()) / 1000);
  if (secondsToClose <= MIN_SECONDS_TO_CLOSE) {
    await logSkip(supabaseAdmin, userId, ticker, pred.close_time, pred.strike, pred.study_locked_side, null, secondsToClose, "retry_window_expired");
    return { ok: true, fired: false, reason: "retry_window_expired", secondsToClose };
  }

  // 2b) Fire-at-lock: skip windows whose lock is already stale.
  const lockedAtMs = (pred as any).study_locked_at ? Date.parse(String((pred as any).study_locked_at)) : NaN;
  const lockAgeSec = Number.isFinite(lockedAtMs) ? Math.round((Date.now() - lockedAtMs) / 1000) : null;
  if (lockAgeSec != null && lockAgeSec > MAX_LOCK_AGE_SEC) {
    await logSkip(supabaseAdmin, userId, ticker, pred.close_time, pred.strike, pred.study_locked_side, null, secondsToClose, `lock_stale_${lockAgeSec}s`);
    return { ok: true, fired: false, reason: "lock_stale", secondsToClose };
  }

  // 3) Idempotency — per (user, ticker) via crypto_trades marker
  const { data: existing } = await supabaseAdmin
    .from("crypto_trades")
    .select("id")
    .eq("user_id", userId)
    .eq("ticker", ticker)
    .filter("inputs_snapshot->>source", "eq", "study_auto_live")
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, fired: false, reason: "already_fired" };
  }

  // 4) Price gate
  const side = pred.study_locked_side as "YES" | "NO";
  const askCents = await fetchKalshiAskCents(ticker, side);
  if (askCents == null) {
    await logSkip(supabaseAdmin, userId, ticker, pred.close_time, pred.strike, side, null, secondsToClose, "no_kalshi_ask");
    return { ok: true, fired: false, reason: "no_kalshi_ask", askCents: null, secondsToClose };
  }
  if (askCents > MAX_ASK_CENTS) {
    await logSkip(supabaseAdmin, userId, ticker, pred.close_time, pred.strike, side, askCents, secondsToClose, `ask_above_${MAX_ASK_CENTS}c`);
    return { ok: true, fired: false, reason: "ask_above_cap", askCents, secondsToClose };
  }

  // 5) Fire — stake is per-user (default $10, max $100)
  const stakeCents = Math.max(100, Math.min(10000, Number((profile as any).study_auto_stake_cents) || STAKE_CENTS));
  const contracts = Math.max(1, Math.floor(stakeCents / askCents));
  const { submitKalshiBuy } = await import("./cryptoTrades.functions");
  try {
    const result = await submitKalshiBuy(supabaseAdmin, userId, {
      ticker,
      side,
      contracts,
      limitPriceCents: askCents,
      strike: pred.strike,
      closeTime: pred.close_time,
      stakeUsd: stakeCents / 100,
      inputsSnapshot: {
        source: "study_auto_live",
        locked_side: pred.study_locked_side,
        lock_price_cents: (pred as any).study_lock_kalshi_price_cents ?? null,
        fire_ask_cents: askCents,
        seconds_to_close: secondsToClose,
        fired_at: new Date().toISOString(),
      },
    });
    if (result.fillCount > 0) {
      await supabaseAdmin
        .from("btc_model_predictions")
        .update({ study_auto_live_fired_at: new Date().toISOString() } as never)
        .eq("ticker", ticker)
        .is("study_auto_live_fired_at", null);
      return {
        ok: true,
        fired: true,
        reason: "filled",
        askCents,
        contracts,
        fillCount: result.fillCount,
        filledCents: result.filledCents,
        tradeId: result.tradeId,
        orderId: result.orderId,
        secondsToClose,
      };
    }
    return { ok: true, fired: false, reason: "unfilled", askCents, secondsToClose };
  } catch (e: any) {
    await logSkip(supabaseAdmin, userId, ticker, pred.close_time, pred.strike, side, askCents, secondsToClose, `error:${(e?.message ?? "unknown").slice(0, 120)}`);
    return { ok: false, fired: false, reason: "error", error: e?.message ?? String(e), askCents, secondsToClose };
  }
}

// Cron driver: iterate all eligible users × currently-locked, un-fired tickers
// and attempt one fire per (user, ticker). Bounded work per tick.
export async function driveStudyAutoLive(): Promise<{
  attempts: number;
  fired: number;
  users: number;
  tickers: number;
  results: Array<{ userId: string; ticker: string; reason: string; fired: boolean }>;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() + MIN_SECONDS_TO_CLOSE * 1000).toISOString();

  // Currently-locked BTC windows: locked side present, not yet fired, still
  // more than MIN_SECONDS_TO_CLOSE seconds until settle.
  const { data: locks } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, close_time, study_locked_side, study_auto_live_fired_at")
    .not("study_locked_side", "is", null)
    .is("study_auto_live_fired_at", null)
    .gt("close_time", cutoffIso)
    .lt("close_time", new Date(Date.now() + 20 * 60 * 1000).toISOString())
    .order("close_time", { ascending: true })
    .limit(20);

  const lockedTickers = (locks ?? []).map((l: any) => l.ticker as string);
  if (lockedTickers.length === 0) {
    return { attempts: 0, fired: 0, users: 0, tickers: 0, results: [] };
  }

  const { data: users } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("study_auto_live_enabled", true)
    .not("kalshi_api_key_id", "is", null)
    .not("kalshi_private_key_pem", "is", null)
    .limit(200);

  const userIds = (users ?? []).map((u: any) => u.id as string);
  if (userIds.length === 0) {
    return { attempts: 0, fired: 0, users: 0, tickers: lockedTickers.length, results: [] };
  }

  const results: Array<{ userId: string; ticker: string; reason: string; fired: boolean }> = [];
  let fired = 0;
  let attempts = 0;

  for (const userId of userIds) {
    for (const ticker of lockedTickers) {
      attempts++;
      try {
        const r = await fireStudyAutoLiveForUser(userId, ticker);
        results.push({ userId, ticker, reason: (r as any).reason ?? "unknown", fired: (r as any).fired === true });
        if ((r as any).fired) fired++;
      } catch (e: any) {
        results.push({ userId, ticker, reason: `throw:${e?.message ?? "unknown"}`, fired: false });
      }
    }
  }

  // Late-flip guard — SHADOW MODE. Find any study_auto_live trades that are
  // still open, within T-60s of settle, where current spot has crossed to the
  // opposite side of strike vs the traded side. Log to auto_trade_skip_log
  // with reason `late_flip_shadow` so we can validate before wiring live exit.
  try {
    const cutoffSoonIso = new Date(Date.now() + 60 * 1000).toISOString();
    const nowIso2 = new Date().toISOString();
    const { data: openFires } = await supabaseAdmin
      .from("crypto_trades")
      .select("id, user_id, ticker, side, strike, close_time, status")
      .eq("status", "submitted")
      .filter("inputs_snapshot->>source", "eq", "study_auto_live")
      .lte("close_time", cutoffSoonIso)
      .gt("close_time", nowIso2)
      .limit(50);
    for (const t of openFires ?? []) {
      try {
        const { data: tick } = await supabaseAdmin
          .from("btc_spot_ticks")
          .select("spot")
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const spot = tick?.spot;
        const strike = (t as any).strike as number | null;
        if (typeof spot !== "number" || !strike) continue;
        const spotSide: "YES" | "NO" = spot >= strike ? "YES" : "NO";
        if (spotSide !== (t as any).side) {
          const secs = Math.round((new Date((t as any).close_time).getTime() - Date.now()) / 1000);
          await supabaseAdmin.from("auto_trade_skip_log").insert({
            user_id: (t as any).user_id,
            ticker: (t as any).ticker,
            close_time: (t as any).close_time,
            side: (t as any).side,
            strike,
            ask_price: null,
            seconds_to_close: secs,
            skip_reason: `late_flip_shadow:spot=${spot.toFixed(2)}:strikeSide=${spotSide}:tradeId=${(t as any).id}`,
          });
        }
      } catch { /* per-row noop */ }
    }
  } catch { /* soft fail */ }

  void nowIso;
  return { attempts, fired, users: userIds.length, tickers: lockedTickers.length, results };
}
