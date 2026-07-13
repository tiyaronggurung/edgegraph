import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlan, currentPeriodStart, type PlanTier } from "@/lib/plans/config";

export const LIMIT_REACHED = "LIMIT_REACHED";

type Counter = "bet_alerts_used" | "ai_verdicts_used";

interface IncrementResult {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  tier: PlanTier;
}

async function incrementCounter(
  ctx: { supabase: any; userId: string },
  counter: Counter,
  limitFor: (tier: PlanTier) => number,
): Promise<IncrementResult> {
  const { supabase, userId } = ctx;
  const period = currentPeriodStart();

  // Read profile (tier + admin flag).
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, is_admin")
    .eq("id", userId)
    .maybeSingle();

  const tier = ((profile?.subscription_tier as PlanTier) ?? "free") as PlanTier;
  const limit = limitFor(tier);

  // Upsert row for this period.
  const { data: existing } = await supabase
    .from("usage_counters")
    .select("id, bet_alerts_used, ai_verdicts_used")
    .eq("user_id", userId)
    .eq("period_start", period)
    .maybeSingle();

  const currentUsed: number = existing?.[counter] ?? 0;

  if (Number.isFinite(limit) && currentUsed >= limit) {
    const err = new Error(LIMIT_REACHED);
    (err as any).code = LIMIT_REACHED;
    (err as any).meta = { tier, limit, used: currentUsed, counter };
    throw err;
  }

  const next = currentUsed + 1;

  if (existing) {
    const { error } = await supabase
      .from("usage_counters")
      .update({ [counter]: next, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const row: Record<string, any> = {
      user_id: userId,
      period_start: period,
      bet_alerts_used: 0,
      ai_verdicts_used: 0,
    };
    row[counter] = 1;
    // Upsert to avoid unique-constraint race when two calls create the same period row.
    const { error } = await supabase
      .from("usage_counters")
      .upsert(row, { onConflict: "user_id,period_start", ignoreDuplicates: true });
    if (error) throw error;
    // If a concurrent insert won the race, our row was ignored — apply the increment now.
    const { data: after } = await supabase
      .from("usage_counters")
      .select(`id, ${counter}`)
      .eq("user_id", userId)
      .eq("period_start", period)
      .maybeSingle();
    if (after && (after as any)[counter] !== 1) {
      const { error: uErr } = await supabase
        .from("usage_counters")
        .update({ [counter]: ((after as any)[counter] ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", (after as any).id);
      if (uErr) throw uErr;
    }
  }

  return {
    ok: true,
    used: next,
    limit: Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER,
    remaining: Number.isFinite(limit) ? Math.max(0, limit - next) : Number.MAX_SAFE_INTEGER,
    tier,
  };
}

export const incrementAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ idempotencyKey: z.string().max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context }) =>
    incrementCounter(context as any, "bet_alerts_used", (t) => getPlan(t).features.betAlertsPerMonth),
  );

export const incrementVerdict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ idempotencyKey: z.string().max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context }) =>
    incrementCounter(context as any, "ai_verdicts_used", (t) => getPlan(t).features.aiVerdictsPerMonth),
  );

export const getPlanAndUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const period = currentPeriodStart();

    const [{ data: profile }, { data: counter }] = await Promise.all([
      supabase
        .from("profiles")
        .select("subscription_tier, subscription_status, billing_interval, current_period_end, is_admin")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("usage_counters")
        .select("bet_alerts_used, ai_verdicts_used, period_start")
        .eq("user_id", userId)
        .eq("period_start", period)
        .maybeSingle(),
    ]);

    const tier = ((profile?.subscription_tier as PlanTier) ?? "free") as PlanTier;
    return {
      tier,
      isAdmin: !!profile?.is_admin,
      status: (profile?.subscription_status as string) ?? "active",
      billingInterval: (profile?.billing_interval as "month" | "year" | null) ?? null,
      currentPeriodEnd: profile?.current_period_end ?? null,
      period,
      usage: {
        betAlertsUsed: counter?.bet_alerts_used ?? 0,
        aiVerdictsUsed: counter?.ai_verdicts_used ?? 0,
      },
    };
  });

// Admin-only tier switch for testing. Server-side gated on profiles.is_admin.
export const adminSetTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ tier: z.enum(["free", "pro", "vip"]) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.is_admin) {
      throw new Error("Forbidden: admin only");
    }
    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: data.tier, subscription_status: "active" })
      .eq("id", userId);
    if (error) throw error;
    return { ok: true, tier: data.tier };
  });
