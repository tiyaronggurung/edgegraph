// Study Pick Auto-Bet (real money).
// Fires ONE $10 IOC buy on Kalshi per (user, ticker) when a Study Pick lock
// exists on that window and Kalshi's ask on the locked side is < 90¢.
// Client drives the retry cadence (every 10s until success or T-60s).
// Server enforces: eligibility, price gate, per-window idempotency, sizing.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Fire logic lives in ./studyAutoLive.server so both the auth'd server fn
// (open-tab retry) and the pg_cron driver (tab closed) share one code path.


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
