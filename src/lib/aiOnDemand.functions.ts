// User-triggered AI refresh. Background cron ticks never call Gemini; a user
// action arms the regime classifier so the next markets computation refreshes it.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const refreshAiRegime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ armed: boolean }> => {
    const { armRegimeRefresh } = await import("./cryptoRegime.server");
    armRegimeRefresh();
    return { armed: true };
  });
