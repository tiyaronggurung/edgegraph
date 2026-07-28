// Client → server: persist the trendline chip's ≥75% locked side to
// btc_model_predictions.study_locked_side as the authoritative Study Pick
// for that window. Overwrites any prior value (chip wins within 7 min).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  ticker: z.string().min(1),
  side: z.enum(["UP", "DOWN"]),
  confidencePct: z.number().min(0).max(100),
  secondsToClose: z.number().int(),
});

export const recordChipStudyPick = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    // Only accept locks fired within the first 7 min of the 15m window.
    if (data.secondsToClose <= 480) {
      return { ok: false, reason: "outside_7min_window" as const };
    }
    if (data.confidencePct < 75) {
      return { ok: false, reason: "below_threshold" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const yesNo = data.side === "UP" ? "YES" : "NO";
    const { error } = await supabaseAdmin
      .from("btc_model_predictions")
      .update({ study_locked_side: yesNo })
      .eq("ticker", data.ticker);
    if (error) return { ok: false, reason: "db_error" as const, error: error.message };
    return { ok: true, wroteSide: yesNo, conf: data.confidencePct };
  });
