import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PatternRow = {
  pattern: string;
  n: number;
  follow_wr_pct: number;
  fade_wr_pct: number;
  avg_channel_width_pct: number | null;
  avg_swings: number | null;
  avg_next_return_pct: number | null;
};

export type PatternReport = {
  rows: PatternRow[];
  total_settled: number;
  config: {
    booster_mode: "follow" | "fade" | "off";
    quality_gates_enabled: boolean;
    min_channel_width_pct: number;
    min_swings: number;
  };
  recommendation: string;
};

export const getTrendlinePatternReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PatternReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: shadow } = await supabaseAdmin
      .from("btc_trendline_shadow")
      .select("is_wedge, wedge_bias, spike_detected, spike_direction, outcome, channel_width_pct, swings_used, next_return_15m")
      .not("outcome", "is", null)
      .limit(10000);

    const rows = shadow ?? [];
    const buckets: Record<string, {
      n: number; follow: number; fade: number;
      widthSum: number; widthCnt: number;
      swingsSum: number; swingsCnt: number;
      retSum: number; retCnt: number;
    }> = {};

    for (const r of rows) {
      let pattern: string | null = null;
      let followSide: "YES" | "NO" | null = null;
      if (r.is_wedge && r.wedge_bias === "bull") { pattern = "bull_wedge"; followSide = "YES"; }
      else if (r.is_wedge && r.wedge_bias === "bear") { pattern = "bear_wedge"; followSide = "NO"; }
      else if (r.spike_detected && r.spike_direction === "up") { pattern = "spike_up"; followSide = "YES"; }
      else if (r.spike_detected && r.spike_direction === "down") { pattern = "spike_down"; followSide = "NO"; }
      if (!pattern || !followSide) continue;

      const b = buckets[pattern] ??= { n: 0, follow: 0, fade: 0, widthSum: 0, widthCnt: 0, swingsSum: 0, swingsCnt: 0, retSum: 0, retCnt: 0 };
      b.n++;
      if (r.outcome === followSide) b.follow++;
      else b.fade++;
      if (r.channel_width_pct != null) { b.widthSum += Number(r.channel_width_pct); b.widthCnt++; }
      if (r.swings_used != null) { b.swingsSum += Number(r.swings_used); b.swingsCnt++; }
      if (r.next_return_15m != null) { b.retSum += Number(r.next_return_15m) * 100; b.retCnt++; }
    }

    const outRows: PatternRow[] = Object.entries(buckets).map(([pattern, b]) => ({
      pattern,
      n: b.n,
      follow_wr_pct: b.n ? +(b.follow / b.n * 100).toFixed(1) : 0,
      fade_wr_pct: b.n ? +(b.fade / b.n * 100).toFixed(1) : 0,
      avg_channel_width_pct: b.widthCnt ? +(b.widthSum / b.widthCnt).toFixed(3) : null,
      avg_swings: b.swingsCnt ? +(b.swingsSum / b.swingsCnt).toFixed(1) : null,
      avg_next_return_pct: b.retCnt ? +(b.retSum / b.retCnt).toFixed(3) : null,
    })).sort((a, b) => b.n - a.n);

    const { data: cfg } = await context.supabase
      .from("btc_trendline_config")
      .select("booster_mode, quality_gates_enabled, min_channel_width_pct, min_swings")
      .eq("id", 1)
      .maybeSingle();

    // Recommendation: pick booster mode based on data
    const followWins = outRows.filter(r => r.n >= 30 && r.follow_wr_pct >= r.fade_wr_pct + 10);
    const fadeWins = outRows.filter(r => r.n >= 30 && r.fade_wr_pct >= r.follow_wr_pct + 10);
    let recommendation = "Insufficient data — hold current mode.";
    if (followWins.length && !fadeWins.length) {
      recommendation = `FOLLOW wins on: ${followWins.map(r => `${r.pattern} (${r.follow_wr_pct}%)`).join(", ")}. Keep booster_mode=follow.`;
    } else if (fadeWins.length && !followWins.length) {
      recommendation = `FADE wins on: ${fadeWins.map(r => `${r.pattern} (${r.fade_wr_pct}%)`).join(", ")}. Consider booster_mode=fade.`;
    } else if (followWins.length && fadeWins.length) {
      recommendation = `Mixed: follow wins ${followWins.map(r => r.pattern).join(",")}; fade wins ${fadeWins.map(r => r.pattern).join(",")}. Consider per-pattern override.`;
    }

    return {
      rows: outRows,
      total_settled: rows.length,
      config: {
        booster_mode: (cfg?.booster_mode as any) ?? "follow",
        quality_gates_enabled: cfg?.quality_gates_enabled ?? false,
        min_channel_width_pct: Number(cfg?.min_channel_width_pct ?? 0),
        min_swings: Number(cfg?.min_swings ?? 0),
      },
      recommendation,
    };
  });
