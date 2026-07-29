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
    const { fireStudyAutoLiveForUser } = await import("./studyAutoLive.server");
    return await fireStudyAutoLiveForUser(userId, data.ticker);
  });


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
