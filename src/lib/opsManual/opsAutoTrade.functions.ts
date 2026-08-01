// Ops Manual auto-trader — admin-only server functions (thin wrappers).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const opsAutoGetStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getOpsAutoStatus } = await import("./opsAutoTrade.admin");
    return await getOpsAutoStatus(context.supabase, context.userId);
  });

export const opsAutoSetEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { setOpsAutoEnabled } = await import("./opsAutoTrade.admin");
    return await setOpsAutoEnabled(context.supabase, context.userId, data.enabled);
  });

/** Dry-run: evaluate the open windows against every rule without ordering. */
export const opsAutoPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { previewOpsAuto } = await import("./opsAutoTrade.admin");
    return await previewOpsAuto(context.supabase, context.userId);
  });
