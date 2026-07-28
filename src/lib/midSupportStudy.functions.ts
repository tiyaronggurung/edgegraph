// Shadow study: does the trendline MID = (BUY+SELL)/2 predict which side of the
// Kalshi strike BTC settles on, bucketed by time-to-close? Read-only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MidSupportRow {
  bucket: string; // "T-600s" | "T-300s" | "T-120s" | "T-30s"
  n: number;
  pct_up: number | null;         // agree-rate: side-of-MID @T matches side-of-strike @close
  avg_mid_dist_pct: number | null;
  edge_vs_baseline: number | null;
}

export const getMidSupportStudy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) =>
    z.object({ days: z.number().int().min(1).max(60).default(14) }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<{ days: number; rows: MidSupportRow[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin.rpc as any)(
      "mid_support_study",
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
        avg_mid_dist_pct: r.avg_mid_dist_pct == null ? null : Number(r.avg_mid_dist_pct),
        edge_vs_baseline: r.edge_vs_baseline == null ? null : Number(r.edge_vs_baseline),
      })),
    };
  });
