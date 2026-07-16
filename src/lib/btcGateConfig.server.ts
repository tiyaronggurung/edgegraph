// Server-only: read the (single-row) BTC gate config with a 30s in-memory
// cache so we don't hammer the DB on every tick. Never throws — on any error
// returns DEFAULT_BTC_GATE_CONFIG so the gate can still run.
//
// Cache lives at module scope. Worker instances are short-lived, so a stale
// window >30s only matters if config changes; readers see it within 30s.
import { DEFAULT_BTC_GATE_CONFIG, type BtcGateConfig } from "./btcEntryGate";

type Cached = { at: number; cfg: BtcGateConfig };
let cache: Cached | null = null;
const TTL_MS = 30_000;

export async function getBtcGateConfig(): Promise<BtcGateConfig> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.cfg;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("btc_gate_config")
      .select(
        "btc_entry_gate_enabled, min_side_confidence, require_live_side_agreement, positive_edge_mode, min_calibrated_edge_points, slippage_buffer_prob, log_gate_decisions, config_version",
      )
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) {
      cache = { at: now, cfg: DEFAULT_BTC_GATE_CONFIG };
      return DEFAULT_BTC_GATE_CONFIG;
    }
    const cfg: BtcGateConfig = {
      btc_entry_gate_enabled: !!data.btc_entry_gate_enabled,
      min_side_confidence: Number(data.min_side_confidence),
      require_live_side_agreement: !!data.require_live_side_agreement,
      positive_edge_mode: data.positive_edge_mode as BtcGateConfig["positive_edge_mode"],
      min_calibrated_edge_points: Number(data.min_calibrated_edge_points),
      slippage_buffer_prob: Number(data.slippage_buffer_prob),
      log_gate_decisions: !!data.log_gate_decisions,
      config_version: Number(data.config_version),
    };
    cache = { at: now, cfg };
    return cfg;
  } catch {
    return DEFAULT_BTC_GATE_CONFIG;
  }
}

/** Invalidate the cache (tests / after admin edits). */
export function invalidateBtcGateConfigCache() {
  cache = null;
}
