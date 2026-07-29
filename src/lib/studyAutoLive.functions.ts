// Study Pick Auto-Bet (real money).
// Fires ONE $10 IOC buy on Kalshi per (user, ticker) when a Study Pick lock
// exists on that window and Kalshi's ask on the locked side is < 90¢.
// Client drives the retry cadence (every 10s until success or T-60s).
// Server enforces: eligibility, price gate, per-window idempotency, sizing.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const STAKE_CENTS = 1000;
const MAX_ASK_CENTS = 89; // fire only if ask <= 89¢ (i.e. < 90¢)
const MIN_SECONDS_TO_CLOSE = 60; // stop retrying inside T-60s

async function fetchKalshiAskCents(ticker: string, side: "YES" | "NO"): Promise<number | null> {
  try {
    const res = await fetch(`${KALSHI}/markets/${encodeURIComponent(ticker)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = await res.json() as {
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

export const getStudyAutoLiveSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as { supabase: any };
    const { data } = await supabase
      .from("profiles")
      .select("study_auto_live_enabled, kalshi_api_key_id, kalshi_private_key_pem")
      .eq("id", (context as any).userId)
      .maybeSingle();
    return {
      enabled: !!data?.study_auto_live_enabled,
      hasKeys: !!(data?.kalshi_api_key_id && data?.kalshi_private_key_pem),
    };
  });

export const setStudyAutoLiveEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ enabled: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { error } = await supabase
      .from("profiles")
      .update({ study_auto_live_enabled: data.enabled })
      .eq("id", (context as any).userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, enabled: data.enabled };
  });

const FireInput = z.object({ ticker: z.string().min(1) });

export const fireStudyAutoLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => FireInput.parse(data))
  .handler(async ({ data, context }) => {
    const userId = (context as any).userId as string;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Eligibility
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("study_auto_live_enabled, kalshi_api_key_id, kalshi_private_key_pem")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.study_auto_live_enabled) return { ok: true, fired: false, reason: "toggle_off" as const };
    if (!profile.kalshi_api_key_id || !profile.kalshi_private_key_pem) {
      return { ok: true, fired: false, reason: "no_keys" as const };
    }

    // 2) Lock + window state
    const { data: pred } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, close_time, strike, study_locked_side, study_lock_kalshi_price_cents")
      .eq("ticker", data.ticker)
      .maybeSingle();
    if (!pred?.study_locked_side || !pred.close_time || !pred.strike) {
      return { ok: true, fired: false, reason: "no_lock" as const };
    }
    const secondsToClose = Math.round((new Date(pred.close_time).getTime() - Date.now()) / 1000);
    if (secondsToClose <= MIN_SECONDS_TO_CLOSE) {
      await logSkip(supabaseAdmin, userId, data.ticker, pred.close_time, pred.strike, pred.study_locked_side, null, secondsToClose, "retry_window_expired");
      return { ok: true, fired: false, reason: "retry_window_expired" as const, secondsToClose };
    }

    // 3) Idempotency — per (user, ticker) via crypto_trades marker
    const { data: existing } = await supabaseAdmin
      .from("crypto_trades")
      .select("id, status")
      .eq("user_id", userId)
      .eq("ticker", data.ticker)
      .filter("inputs_snapshot->>source", "eq", "study_auto_live")
      .limit(1);
    if (existing && existing.length > 0) {
      return { ok: true, fired: false, reason: "already_fired" as const };
    }

    // 4) Price gate — fetch fresh ask, apply < 90¢ rule
    const side = pred.study_locked_side as "YES" | "NO";
    const askCents = await fetchKalshiAskCents(data.ticker, side);
    if (askCents == null) {
      await logSkip(supabaseAdmin, userId, data.ticker, pred.close_time, pred.strike, side, null, secondsToClose, "no_kalshi_ask");
      return { ok: true, fired: false, reason: "no_kalshi_ask" as const, secondsToClose };
    }
    if (askCents > MAX_ASK_CENTS) {
      await logSkip(supabaseAdmin, userId, data.ticker, pred.close_time, pred.strike, side, askCents, secondsToClose, "ask_ge_90c");
      return { ok: true, fired: false, reason: "ask_ge_90c" as const, askCents, secondsToClose };
    }

    // 5) Fire
    const contracts = Math.max(1, Math.floor(STAKE_CENTS / askCents));
    const { submitKalshiBuy } = await import("./cryptoTrades.functions");
    try {
      const result = await submitKalshiBuy(supabaseAdmin, userId, {
        ticker: data.ticker,
        side,
        contracts,
        limitPriceCents: askCents,
        strike: pred.strike,
        closeTime: pred.close_time,
        stakeUsd: STAKE_CENTS / 100,
        inputsSnapshot: {
          source: "study_auto_live",
          locked_side: pred.study_locked_side,
          lock_price_cents: pred.study_lock_kalshi_price_cents ?? null,
          fire_ask_cents: askCents,
          seconds_to_close: secondsToClose,
          fired_at: new Date().toISOString(),
        },
      });
      // 6) Mark prediction row (idempotency + audit)
      if (result.fillCount > 0) {
        await supabaseAdmin
          .from("btc_model_predictions")
          .update({ study_auto_live_fired_at: new Date().toISOString() } as never)
          .eq("ticker", data.ticker)
          .is("study_auto_live_fired_at", null);
      }
      return {
        ok: true,
        fired: result.fillCount > 0,
        reason: result.fillCount > 0 ? ("filled" as const) : ("unfilled" as const),
        askCents,
        contracts,
        fillCount: result.fillCount,
        filledCents: result.filledCents,
        tradeId: result.tradeId,
        orderId: result.orderId,
        secondsToClose,
      };
    } catch (e: any) {
      await logSkip(supabaseAdmin, userId, data.ticker, pred.close_time, pred.strike, side, askCents, secondsToClose, `error:${(e?.message ?? "unknown").slice(0, 120)}`);
      return { ok: false, fired: false, reason: "error" as const, error: e?.message ?? String(e), askCents, secondsToClose };
    }
  });

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

// Today's fires (for the UI card).
export const getStudyAutoLiveStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = (context as any).userId as string;
    const { supabase } = context as { supabase: any };
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { data: fires } = await supabase
      .from("crypto_trades")
      .select("id, status, market_yes_price, contracts, ticker, kalshi_order_id, created_at, inputs_snapshot")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .filter("inputs_snapshot->>source", "eq", "study_auto_live")
      .order("created_at", { ascending: false })
      .limit(50);
    return { fires: fires ?? [] };
  });
