// Read-only history: per-15m-window flow (BTC in vs out) + actual result.
// Display only — nothing here touches entry, study, model or trendline paths.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface FlowLeanHistoryRow {
  windowStart: string;
  lean: string;
  imbWindow: number | null;
  buyBtc: number | null;
  sellBtc: number | null;
  volBtc: number | null;
  /** "UP" | "DOWN" from the 15m candle open vs close, null while unsettled. */
  result: "UP" | "DOWN" | null;
  hit: boolean | null;
}

export interface FlowLeanHistoryResult {
  rows: FlowLeanHistoryRow[];
  scored: number;
  hits: number;
}

const WINDOW_MS = 15 * 60 * 1000;

export const getBtcFlowLeanHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FlowLeanHistoryResult> => {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: logs } = await context.supabase
      .from("btc_flow_lean_log")
      .select("window_start, seconds_to_close, lean, imb_window, buy_window_btc, sell_window_btc, vol_window_btc")
      .gte("window_start", since)
      .order("window_start", { ascending: false })
      .order("seconds_to_close", { ascending: true })
      .limit(500);

    // Keep the latest row (smallest seconds_to_close) per window.
    const byWindow = new Map<string, NonNullable<typeof logs>[number]>();
    for (const r of logs ?? []) {
      const key = new Date(r.window_start as string).toISOString();
      if (!byWindow.has(key)) byWindow.set(key, r);
    }

    // Actual 15m candle direction from Binance (open vs close).
    const dir = new Map<string, "UP" | "DOWN">();
    try {
      const res = await fetch(
        "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=60",
      );
      if (res.ok) {
        const kl = (await res.json()) as unknown[][];
        const nowWindow = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
        for (const k of kl) {
          const openTime = Number(k[0]);
          if (openTime >= nowWindow) continue; // current window not closed yet
          const open = Number(k[1]);
          const close = Number(k[4]);
          dir.set(new Date(openTime).toISOString(), close >= open ? "UP" : "DOWN");
        }
      }
    } catch {
      /* leave results null */
    }

    let scored = 0;
    let hits = 0;
    const rows: FlowLeanHistoryRow[] = [...byWindow.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 16)
      .map(([key, r]) => {
        const result = dir.get(key) ?? null;
        const lean = (r.lean as string) ?? "FLAT";
        let hit: boolean | null = null;
        if (result && (lean === "UP" || lean === "DOWN")) {
          hit = lean === result;
          scored += 1;
          if (hit) hits += 1;
        }
        return {
          windowStart: key,
          lean,
          imbWindow: r.imb_window as number | null,
          buyBtc: r.buy_window_btc as number | null,
          sellBtc: r.sell_window_btc as number | null,
          volBtc: r.vol_window_btc as number | null,
          result,
          hit,
        };
      });

    return { rows, scored, hits };
  });
