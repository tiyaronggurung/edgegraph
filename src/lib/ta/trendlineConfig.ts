// Read-through cache for the singleton trendline booster config.
// Refreshes every 60s so admin toggles take effect quickly without adding
// per-prediction DB latency.
import type { SupabaseClient } from "@supabase/supabase-js";

export type TrendlineConfig = {
  booster_mode: "follow" | "fade" | "hybrid" | "off";
  quality_gates_enabled: boolean;
  min_channel_width_pct: number;
  min_swings: number;
};

const DEFAULT: TrendlineConfig = {
  booster_mode: "follow",
  quality_gates_enabled: false,
  min_channel_width_pct: 0,
  min_swings: 0,
};

let cache: { at: number; value: TrendlineConfig } | null = null;
const TTL_MS = 60_000;

export async function getTrendlineConfig(supabase: SupabaseClient): Promise<TrendlineConfig> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const { data } = await supabase
      .from("btc_trendline_config")
      .select("booster_mode, quality_gates_enabled, min_channel_width_pct, min_swings")
      .eq("id", 1)
      .maybeSingle();
    const value: TrendlineConfig = data
      ? {
          booster_mode: (data.booster_mode as any) ?? "follow",
          quality_gates_enabled: !!data.quality_gates_enabled,
          min_channel_width_pct: Number(data.min_channel_width_pct ?? 0),
          min_swings: Number(data.min_swings ?? 0),
        }
      : DEFAULT;
    cache = { at: now, value };
    return value;
  } catch {
    return cache?.value ?? DEFAULT;
  }
}
