// Shadow study: aggregates trendline BUY (support) / SELL (resistance) breaks
// vs. Kalshi 15m settlement. Read-only — no trading impact.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface TrendlineBreakRow {
  bucket: "support_broken" | "resist_broken" | "both_broken" | "both_held" | string;
  n: number;
  pct_up: number | null;
  avg_dist_pct: number | null;
}

export const getTrendlineBreakStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) =>
    z.object({ days: z.number().int().min(1).max(60).default(14) }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<{ days: number; rows: TrendlineBreakRow[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin.rpc as any)(
      "trendline_break_study",
      { _days: data.days },
    );
    if (error) throw new Error(error.message);
    const arr: any[] = Array.isArray(rows) ? rows : [];
    return {
      days: data.days,
      rows: arr.map((r) => ({
        bucket: r.bucket,
        n: Number(r.n ?? 0),
        pct_up: r.pct_up == null ? null : Number(r.pct_up),
        avg_dist_pct: r.avg_dist_pct == null ? null : Number(r.avg_dist_pct),
      })),
    };
  });
