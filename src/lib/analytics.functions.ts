import { supabase } from "@/integrations/supabase/client";

export type UpgradeEventType =
  | "upgrade_prompt_shown"
  | "upgrade_button_clicked"
  | "pricing_page_viewed"
  | "plan_selected";

export interface TrackUpgradeArgs {
  type: UpgradeEventType;
  context?: string;
  targetPlan?: "free" | "pro" | "vip" | null;
  metadata?: Record<string, unknown>;
}

// Client-side fire-and-forget analytics. Failures are swallowed so the
// pricing UX never breaks.
export async function trackUpgradeEvent(args: TrackUpgradeArgs): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id ?? null;
    await supabase.from("upgrade_events").insert({
      user_id: userId,
      event_type: args.type,
      context: args.context ?? null,
      target_plan: args.targetPlan ?? null,
      metadata: (args.metadata ?? {}) as any,
    });
  } catch (err) {
    console.warn("[upgrade-analytics] insert failed", err);
  }
}
