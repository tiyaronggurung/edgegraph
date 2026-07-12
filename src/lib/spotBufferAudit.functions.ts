// Read-only audit of the btc_spot_ticks buffer. Reports data-quality metrics
// so we can trust the jump-feature builder before any live policy is
// recommended. Does NOT modify any table, gate, or scoring path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SpotSourceAudit {
  source: string;
  rows: number;
  first_iso: string | null;
  last_iso: string | null;
  with_source_timestamp: number;
  with_source_timestamp_pct: number;
  out_of_order: number;
  out_of_order_pct: number;
  // Sampling interval (seconds between successive observed_at per source)
  interval_median_s: number | null;
  interval_p95_s: number | null;
  interval_max_s: number | null;
  // Latency between exchange time and insert time (ms), only rows with source_timestamp
  latency_median_ms: number | null;
  latency_p95_ms: number | null;
  latency_max_ms: number | null;
  // Coverage: unique observed-seconds / span-seconds
  unique_seconds: number;
  span_seconds: number;
  coverage_pct: number;
}

export interface SpotBufferAuditResponse {
  fromIso: string;
  toIso: string;
  totalRows: number;
  perSource: SpotSourceAudit[];
  dedupIndexes: Array<{ name: string; predicate: string }>;
  warnings: string[];
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}

export const runSpotBufferAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fromIso?: string; toIso?: string; limit?: number }) => data)
  .handler(async ({ data, context }) => {
    const toIso = data.toIso ?? new Date().toISOString();
    const fromIso = data.fromIso ?? new Date(Date.now() - 60 * 60_000).toISOString();
    const limit = Math.min(50000, data.limit ?? 20000);

    const { data: rows, error } = await context.supabase
      .from("btc_spot_ticks")
      .select("source, observed_at, source_timestamp, received_at, latency_ms, out_of_order")
      .gte("observed_at", fromIso)
      .lte("observed_at", toIso)
      .order("observed_at", { ascending: true })
      .limit(limit);
    if (error) throw error;

    const all = rows ?? [];
    const bySource = new Map<string, typeof all>();
    for (const r of all) {
      const s = String(r.source ?? "unknown");
      if (!bySource.has(s)) bySource.set(s, []);
      bySource.get(s)!.push(r);
    }

    const perSource: SpotSourceAudit[] = [];
    const warnings: string[] = [];

    for (const [source, list] of bySource) {
      const withTs = list.filter(r => r.source_timestamp != null);
      const ooo = list.filter(r => (r as { out_of_order?: boolean }).out_of_order === true);
      const first = list[0]?.observed_at ?? null;
      const last = list[list.length - 1]?.observed_at ?? null;

      // Intervals between consecutive observed_at (in seconds)
      const intervals: number[] = [];
      for (let i = 1; i < list.length; i++) {
        const a = Date.parse(list[i - 1].observed_at as string);
        const b = Date.parse(list[i].observed_at as string);
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a) intervals.push((b - a) / 1000);
      }
      intervals.sort((a, b) => a - b);

      const lats = withTs
        .map(r => Number((r as { latency_ms?: number | null }).latency_ms))
        .filter(v => Number.isFinite(v) && v >= 0)
        .sort((a, b) => a - b);

      const uniqueSecs = new Set(
        list.map(r => Math.floor(Date.parse(r.observed_at as string) / 1000)),
      );
      const spanSec = first && last ? Math.max(1, Math.floor((Date.parse(last) - Date.parse(first)) / 1000)) : 0;
      const coverage = spanSec > 0 ? uniqueSecs.size / spanSec : 0;

      perSource.push({
        source,
        rows: list.length,
        first_iso: first as string | null,
        last_iso: last as string | null,
        with_source_timestamp: withTs.length,
        with_source_timestamp_pct: list.length ? withTs.length / list.length : 0,
        out_of_order: ooo.length,
        out_of_order_pct: list.length ? ooo.length / list.length : 0,
        interval_median_s: percentile(intervals, 0.5),
        interval_p95_s: percentile(intervals, 0.95),
        interval_max_s: intervals.length ? intervals[intervals.length - 1] : null,
        latency_median_ms: percentile(lats, 0.5),
        latency_p95_ms: percentile(lats, 0.95),
        latency_max_ms: lats.length ? lats[lats.length - 1] : null,
        unique_seconds: uniqueSecs.size,
        span_seconds: spanSec,
        coverage_pct: coverage,
      });

      // Heuristic warnings
      if (list.length > 0 && withTs.length === 0 && source !== "consolidated" && source !== "kraken") {
        warnings.push(`${source}: no source_timestamp on any row — recorder not writing exchange time`);
      }
      if (percentile(intervals, 0.5) != null && (percentile(intervals, 0.5) as number) > 30) {
        warnings.push(`${source}: median sampling interval ${(percentile(intervals, 0.5) as number).toFixed(1)}s (>30s — thin for 30s jump window)`);
      }
      if (lats.length && (percentile(lats, 0.95) as number) > 5000) {
        warnings.push(`${source}: p95 latency ${((percentile(lats, 0.95) as number) / 1000).toFixed(1)}s`);
      }
      if (ooo.length > 0) {
        warnings.push(`${source}: ${ooo.length} out-of-order tick(s)`);
      }
    }

    perSource.sort((a, b) => b.rows - a.rows);

    return {
      fromIso,
      toIso,
      totalRows: all.length,
      perSource,
      // Reported for UI clarity; matches the actual partial unique indexes.
      dedupIndexes: [
        { name: "btc_spot_ticks_dedup_source_ts", predicate: "(source, source_timestamp) WHERE source_timestamp IS NOT NULL" },
        { name: "btc_spot_ticks_dedup_rounded", predicate: "(source, observed_at_sec) WHERE source_timestamp IS NULL" },
      ],
      warnings,
    } satisfies SpotBufferAuditResponse;
  });
