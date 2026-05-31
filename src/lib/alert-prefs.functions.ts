import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlan, type PlanTier } from "@/lib/plans/config";

export type AlertFrequency = "instant" | "daily_digest" | "off";
export const ALERT_FREQUENCIES: AlertFrequency[] = ["instant", "daily_digest", "off"];
export const ALERT_SPORT_OPTIONS = ["NBA", "NFL", "MLB", "NHL", "Soccer"] as const;

export interface AlertPrefs {
  alertFrequency: AlertFrequency;
  alertSportFilters: string[];
  alertMinConfidence: number;
  tier: PlanTier;
  isAdmin: boolean;
  canCustomize: boolean; // pro/vip only
}

function canCustomize(tier: PlanTier): boolean {
  return tier === "pro" || tier === "vip";
}

export const getAlertPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertPrefs> => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("profiles")
      .select(
        "subscription_tier, is_admin, alert_frequency, alert_sport_filters, alert_min_confidence",
      )
      .eq("id", userId)
      .maybeSingle();
    const tier = ((data?.subscription_tier as PlanTier) ?? "free") as PlanTier;
    return {
      alertFrequency: (data?.alert_frequency as AlertFrequency) ?? "instant",
      alertSportFilters: (data?.alert_sport_filters as string[]) ?? [],
      alertMinConfidence: Number(data?.alert_min_confidence ?? 0),
      tier,
      isAdmin: !!data?.is_admin,
      canCustomize: canCustomize(tier),
    };
  });

export const updateAlertPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        alertFrequency: z.enum(["instant", "daily_digest", "off"]),
        alertSportFilters: z.array(z.string().max(20)).max(20).default([]),
        alertMinConfidence: z.number().min(0).max(100).default(0),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", userId)
      .maybeSingle();
    const tier = ((profile?.subscription_tier as PlanTier) ?? "free") as PlanTier;
    if (!canCustomize(tier)) {
      throw new Error("Upgrade to Pro or VIP to customize alert preferences");
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        alert_frequency: data.alertFrequency,
        alert_sport_filters: data.alertSportFilters,
        alert_min_confidence: data.alertMinConfidence,
      })
      .eq("id", userId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Evaluate whether a BET alert should be delivered to the user, and how.
 * Returns "skip" if filters block it, "send_instant" for immediate email,
 * or "queue_digest" to enqueue for the daily rollup.
 *
 * Free users always get "send_instant" (their cap is enforced by incrementAlert).
 */
export const evaluateAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        confidence: z.number().min(0).max(100).optional(),
        sport: z.string().max(40).optional().nullable(),
        marketTicker: z.string().max(200),
        marketTitle: z.string().max(500).optional().nullable(),
        side: z.string().max(20),
        sideLabel: z.string().max(80).optional().nullable(),
        fairProb: z.number().optional(),
        marketProb: z.number().optional(),
        edgePts: z.number().optional(),
        pattern: z.string().max(120).optional().nullable(),
        kellyHalf: z.number().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, alert_frequency, alert_sport_filters, alert_min_confidence")
      .eq("id", userId)
      .maybeSingle();

    const tier = ((profile?.subscription_tier as PlanTier) ?? "free") as PlanTier;
    const freq: AlertFrequency = canCustomize(tier)
      ? ((profile?.alert_frequency as AlertFrequency) ?? "instant")
      : "instant";
    const sportFilters: string[] = canCustomize(tier)
      ? ((profile?.alert_sport_filters as string[]) ?? [])
      : [];
    const minConf: number = canCustomize(tier)
      ? Number(profile?.alert_min_confidence ?? 0)
      : 0;

    if (freq === "off") return { action: "skip" as const, reason: "frequency_off" };

    if (sportFilters.length > 0) {
      const sport = (data.sport ?? "").toString();
      if (!sport || !sportFilters.includes(sport)) {
        return { action: "skip" as const, reason: "sport_filtered" };
      }
    }

    if (minConf > 0 && typeof data.confidence === "number" && data.confidence < minConf) {
      return { action: "skip" as const, reason: "below_confidence" };
    }

    if (freq === "daily_digest") {
      // Enqueue (dedupe via unique index). Ignore conflicts.
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("pending_digest_alerts").insert({
        user_id: userId,
        market_ticker: data.marketTicker,
        market_title: data.marketTitle ?? null,
        side: data.side,
        side_label: data.sideLabel ?? null,
        fair_prob: data.fairProb ?? null,
        market_prob: data.marketProb ?? null,
        edge_pts: data.edgePts ?? null,
        pattern: data.pattern ?? null,
        kelly_half: data.kellyHalf ?? null,
        sport: data.sport ?? null,
        alert_date: today,
      });
      // Ignore unique-constraint violations (already queued today).
      if (error && !String(error.message ?? "").toLowerCase().includes("duplicate")) {
        // Non-dedupe error — log but don't block the in-app badge flow.
        console.warn("[evaluateAlert] queue insert failed", error);
      }
      return { action: "queue_digest" as const };
    }

    // instant
    const plan = getPlan(tier);
    return { action: "send_instant" as const, tier, limit: plan.features.betAlertsPerMonth };
  });
