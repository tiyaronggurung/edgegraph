// BTC "Flow lean" — read-only directional read from spot taker buy/sell
// imbalance inside the current 15m window. Display + logging only; nothing
// here touches entry, study, model or trendline paths.
//
// Win-rate table comes from our own recorded windows (odds snapshots joined
// to settled markets): strong imbalance (>10%) predicted the matching side
// 59-72% of the time, strongest in the last 2-5 minutes.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FlowLean = "UP" | "DOWN" | "FLAT";

export const STRONG_IMB = 0.1;
export const WEAK_IMB = 0.03;

/** Historical win rate for a strong lean, by minutes remaining in the window. */
export function flowLeanWinRate(lean: FlowLean, secondsToClose: number): number | null {
  if (lean === "FLAT") return 0.53;
  const up = lean === "UP";
  if (secondsToClose <= 120) return up ? 0.71 : 0.68;
  if (secondsToClose <= 300) return up ? 0.66 : 0.72;
  if (secondsToClose <= 600) return up ? 0.66 : 0.65;
  if (secondsToClose <= 900) return up ? 0.59 : 0.65;
  return null;
}

export function computeFlowLean(imbalance: number | null | undefined): FlowLean {
  if (imbalance == null || !Number.isFinite(imbalance)) return "FLAT";
  if (imbalance >= STRONG_IMB) return "UP";
  if (imbalance <= -STRONG_IMB) return "DOWN";
  return "FLAT";
}

export interface FlowLeanLogInput {
  windowStart: string;
  secondsToClose: number;
  lean: FlowLean;
  imbM3: number | null;
  imbWindow: number | null;
  volWindowBtc: number | null;
  buyWindowBtc: number | null;
  sellWindowBtc: number | null;
  spot: number | null;
  expectedWinRate: number | null;
}

/** Append-only history row so we can score the lean later against outcomes. */
export const logBtcFlowLean = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: FlowLeanLogInput) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("btc_flow_lean_log").insert({
      window_start: data.windowStart,
      seconds_to_close: Math.round(data.secondsToClose),
      lean: data.lean,
      imb_m3: data.imbM3,
      imb_window: data.imbWindow,
      vol_window_btc: data.volWindowBtc,
      buy_window_btc: data.buyWindowBtc,
      sell_window_btc: data.sellWindowBtc,
      spot: data.spot,
      expected_win_rate: data.expectedWinRate,
    });
    return { ok: !error, error: error?.message ?? null };
  });
