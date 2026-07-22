// Multi-TF shadow stats panel — READ-ONLY. Compares TA-only vs multi-TF-filtered
// outcomes over rolling settled windows. Shows WR + P/L proxy + skip breakdown.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  id: string;
  window_ticker: string;
  decision_state: string;
  ta_only_side: string | null;
  ta_only_result: string | null;
  multi_tf_side: string | null;
  multi_tf_result: string | null;
  conflict_reason: string | null;
  kalshi_ask: number | null;
  eligible_to_fire: boolean | null;
  settled_outcome: string | null;
  side_flip_count: number | null;
  proposed_side: string | null;
  side_confidence: number | null;
  strike_distance_usd: number | null;
  spot_price: number | null;
  nearest_support_usd: number | null;
  nearest_resistance_usd: number | null;
}

function stats(rows: Row[], side: "ta" | "mtf") {
  const key = side === "ta" ? "ta_only_result" : "multi_tf_result";
  const wins = rows.filter((r) => r[key] === "WIN").length;
  const losses = rows.filter((r) => r[key] === "LOSS").length;
  const skips = rows.filter((r) => r[key] === "SKIP").length;
  const total = wins + losses;
  const wr = total > 0 ? (wins / total) * 100 : 0;
  // Simple P/L proxy: assume $10 stake at avg ask; win pays $10*(100-ask)/ask, loss = -$10.
  let pl = 0;
  for (const r of rows) {
    const res = r[key];
    if (res !== "WIN" && res !== "LOSS") continue;
    const ask = r.kalshi_ask ?? 60;
    if (res === "WIN") pl += 10 * ((100 - ask) / ask);
    else pl -= 10;
  }
  return { wins, losses, skips, total, wr, pl };
}

export function MultiTfShadowPanel() {
  const q = useQuery({
    queryKey: ["multi-tf-shadow"],
    refetchInterval: 30_000,
    queryFn: async () => {
      // Only take the most-eligible snapshot per window: filter to ELIGIBLE state
      // that has been settled — one decision per window.
      const { data, error } = await supabase
        .from("btc_multi_tf_decision_log")
        .select("*")
        .eq("decision_state", "ELIGIBLE")
        .not("settled_outcome", "is", null)
        .order("window_close_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      // Dedupe to one row per window (first eligible snapshot per window)
      const seen = new Set<string>();
      const rows: Row[] = [];
      for (const r of (data ?? []) as any[]) {
        if (seen.has(r.window_ticker)) continue;
        seen.add(r.window_ticker);
        rows.push(r);
      }
      return rows;
    },
  });

  const rows = q.data ?? [];
  const last50 = rows.slice(0, 50);
  const last200 = rows.slice(0, 200);
  const taAll = stats(rows, "ta");
  const mtfAll = stats(rows, "mtf");
  const ta200 = stats(last200, "ta");
  const mtf200 = stats(last200, "mtf");
  const ta50 = stats(last50, "ta");
  const mtf50 = stats(last50, "mtf");

  // Skip breakdown
  const conflicts = new Map<string, number>();
  for (const r of rows) {
    if (r.conflict_reason) conflicts.set(r.conflict_reason, (conflicts.get(r.conflict_reason) ?? 0) + 1);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">Multi-TF Shadow · <span className="text-muted-foreground font-normal">v1</span></h3>
        <span className="text-xs text-muted-foreground">
          {rows.length} settled windows · refreshes 30s
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No settled snapshots yet. Cron runs every minute; first settled comparisons appear ~15 min after enabling.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatBox title="TA-Only (all)" s={taAll} />
            <StatBox title="Multi-TF (all)" s={mtfAll} highlight />
            <StatBox title="TA-Only (last 200)" s={ta200} />
            <StatBox title="Multi-TF (last 200)" s={mtf200} highlight />
            <StatBox title="TA-Only (last 50)" s={ta50} />
            <StatBox title="Multi-TF (last 50)" s={mtf50} highlight />
          </div>

          {conflicts.size > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Skip reasons</div>
              <div className="flex flex-wrap gap-2">
                {Array.from(conflicts.entries()).map(([reason, n]) => (
                  <span key={reason} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                    {reason}: {n}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground italic">
            50 windows = sanity only. 200–300 needed for meaningful comparison vs 88% PRED baseline.
            Compare P/L, not just WR — filter that removes profitable trades can lower net.
          </p>
        </>
      )}
    </div>
  );
}

function StatBox({ title, s, highlight }: { title: string; s: ReturnType<typeof stats>; highlight?: boolean }) {
  return (
    <div className={`rounded p-3 border ${highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/30"}`}>
      <div className="text-[11px] text-muted-foreground">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{s.wr.toFixed(1)}%</span>
        <span className="text-xs text-muted-foreground">WR</span>
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">
        {s.wins}W · {s.losses}L · {s.skips}skip · P/L ${s.pl.toFixed(1)}
      </div>
    </div>
  );
}
