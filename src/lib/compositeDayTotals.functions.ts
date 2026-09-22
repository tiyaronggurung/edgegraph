// Running day-to-date composite (Binance + Coinbase) in/out volume.
//
// Each 15m window's stored rows are cumulative within that window, so the
// day total is the sum of the LAST row of every window since New York
// midnight. Read-only: this file only reads btc_composite_flow_log.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface CompositeDayTotals {
  ok: boolean;
  dayStartIso: string;
  windows: number;
  inBtc: number;
  outBtc: number;
  netBtc: number;
  imbalance: number | null;
  avgIn: number | null;
  avgOut: number | null;
}

/** UTC timestamp of the most recent midnight in America/New_York. */
function nyMidnightUtcMs(nowMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(nowMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const hour = p.hour === 24 ? 0 : p.hour;
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
  const offset = wallAsUtc - Math.floor(nowMs / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day) - offset;
}

export const getCompositeDayTotals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompositeDayTotals> => {
    const dayStart = nyMidnightUtcMs(Date.now());
    const dayStartIso = new Date(dayStart).toISOString();
    const empty: CompositeDayTotals = {
      ok: false,
      dayStartIso,
      windows: 0,
      inBtc: 0,
      outBtc: 0,
      netBtc: 0,
      imbalance: null,
      avgIn: null,
      avgOut: null,
    };

    // PostgREST caps a single response at 1000 rows, so page through the day
    // newest-first. Newest row per window wins (rows are cumulative inside a
    // window), which is why the first row seen for a window is the keeper.
    type Row = {
      window_start: string;
      recorded_at: string | null;
      composite_in_btc: number | null;
      composite_out_btc: number | null;
      composite_avg_in: number | null;
      composite_avg_out: number | null;
    };
    const last = new Map<string, Row>();
    const PAGE = 1000;
    for (let page = 0; page < 12; page++) {
      const { data, error } = await context.supabase
        .from("btc_composite_flow_log")
        .select(
          "window_start, recorded_at, composite_in_btc, composite_out_btc, composite_avg_in, composite_avg_out",
        )
        .gte("window_start", dayStartIso)
        .order("recorded_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return last.size > 0 ? finalize(last, dayStartIso) : empty;
      const rows = (data ?? []) as Row[];
      for (const r of rows) {
        const key = String(r.window_start);
        if (!last.has(key)) last.set(key, r);
      }
      if (rows.length < PAGE) break;
    }
    if (last.size === 0) return empty;
    return finalize(last, dayStartIso);
  });

function finalize(
  last: Map<
    string,
    {
      composite_in_btc: number | null;
      composite_out_btc: number | null;
      composite_avg_in: number | null;
      composite_avg_out: number | null;
    }
  >,
  dayStartIso: string,
): CompositeDayTotals {
  {

    let inBtc = 0;
    let outBtc = 0;
    let inNotional = 0;
    let outNotional = 0;
    for (const r of last.values()) {
      const ci = Number(r.composite_in_btc);
      const co = Number(r.composite_out_btc);
      if (Number.isFinite(ci) && ci > 0) {
        inBtc += ci;
        const px = Number(r.composite_avg_in);
        if (Number.isFinite(px) && px > 0) inNotional += ci * px;
      }
      if (Number.isFinite(co) && co > 0) {
        outBtc += co;
        const px = Number(r.composite_avg_out);
        if (Number.isFinite(px) && px > 0) outNotional += co * px;
      }
    }

    const total = inBtc + outBtc;
    return {
      ok: last.size > 0,
      dayStartIso,
      windows: last.size,
      inBtc,
      outBtc,
      netBtc: inBtc - outBtc,
      imbalance: total > 0 ? (inBtc - outBtc) / total : null,
      avgIn: inBtc > 0 && inNotional > 0 ? inNotional / inBtc : null,
      avgOut: outBtc > 0 && outNotional > 0 ? outNotional / outBtc : null,
    };
  });
