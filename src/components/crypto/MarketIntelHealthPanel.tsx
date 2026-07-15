import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketIntelHealth, matchPendingSettlements } from "@/lib/marketIntel/marketIntelOps.functions";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";

/**
 * Admin-only diagnostic tile for the shadow MarketIntel pipeline.
 * Reads from the collection-health view; renders nothing when the caller
 * isn't admin (server returns null).
 */
export function MarketIntelHealthPanel() {
  const fetchHealth = useServerFn(getMarketIntelHealth);
  const runMatcher = useServerFn(matchPendingSettlements);
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["marketIntelHealth"],
    queryFn: () => fetchHealth(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const matchMut = useMutation({
    mutationFn: () => runMatcher({ data: { graceMinutes: 5, maxRows: 2000 } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["marketIntelHealth"] }),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading MarketIntel health…
      </div>
    );
  }

  // Non-admin or view empty
  if (!data) return null;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const ms = (n: number | null) => (n == null ? "—" : `${Math.round(n)}ms`);
  const days = (n: number | null) => (n == null ? "—" : n < 0 ? "reached" : `${n.toFixed(1)}d`);
  const activeAlerts = Object.entries(data.alerts).filter(([, v]) => v).map(([k]) => k);

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          <Activity className="h-3.5 w-3.5 text-primary" />
          MarketIntel — shadow collection health
          <span className="text-muted-foreground font-normal">(admin, 7d)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => matchMut.mutate()}
            disabled={matchMut.isPending}
            className="rounded border border-border/50 px-2 py-0.5 hover:bg-muted/40 disabled:opacity-50"
            title="Flip pending → matched/missing based on btc_model_predictions"
          >
            {matchMut.isPending ? "Matching…" : "Match settlements"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded border border-border/50 p-1 hover:bg-muted/40 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {data.total_snapshots === 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">No snapshots collected in the last 7 days.</div>
            <div className="text-amber-300/80">
              Pipeline is not landing writes. Check server logs for [marketIntel] warnings.
            </div>
          </div>
        </div>
      )}

      {matchMut.data && (
        <div className="rounded border border-border/40 bg-muted/20 p-2 text-muted-foreground">
          Last match run: scanned {matchMut.data.scanned}, matched {matchMut.data.matched},
          missing {matchMut.data.missing}, ambiguous {matchMut.data.ambiguous}
          {matchMut.data.ok === false ? ` (${matchMut.data.reason})` : ""}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Snapshots" value={data.total_snapshots.toLocaleString()} />
        <Stat label="Unique tickers" value={data.unique_tickers.toLocaleString()} />
        <Stat label="Unique settled" value={data.unique_settled_tickers.toLocaleString()} />
        <Stat label="Rows/hour" value={data.rows_per_hour == null ? "—" : data.rows_per_hour.toFixed(1)} />
        <Stat label="Matched %" value={pct(data.matched_pct)} good={data.matched_pct >= 0.98} bad={data.matched_pct < 0.9 && data.matched_rows > 0} />
        <Stat label="Error %" value={pct(data.error_pct)} bad={data.error_pct > 0.01} />
        <Stat label="Insufficient %" value={pct(data.insufficient_pct)} bad={data.insufficient_pct > 0.1} />
        <Stat label="Partial %" value={pct(data.partial_pct)} />
        <Stat label="Missing 5m %" value={pct(data.missing_5m_pct)} bad={data.missing_5m_pct > 0.05} />
        <Stat label="Calc p95" value={ms(data.p95_calc_ms)} />
        <Stat label="Input lag p95" value={ms(data.p95_input_lag_ms)} bad={(data.p95_input_lag_ms ?? 0) > 5000} />
        <Stat label="Avg snap / ticker" value={data.avg_snapshots_per_ticker == null ? "—" : data.avg_snapshots_per_ticker.toFixed(1)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Days → 500 settled" value={days(data.days_to_500_windows)} />
        <Stat label="Days → 1000 settled" value={days(data.days_to_1000_windows)} />
      </div>

      {activeAlerts.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Alerts firing:</div>
            <ul className="list-disc ml-4">
              {activeAlerts.map(a => <li key={a}>{a.replace(/^alert_/, "").replace(/_/g, " ")}</li>)}
            </ul>
          </div>
        </div>
      )}
      {activeAlerts.length === 0 && data.total_snapshots > 0 && (
        <div className="flex items-center gap-2 text-emerald-400/80">
          <CheckCircle2 className="h-3.5 w-3.5" /> All health checks passing.
        </div>
      )}

      <details className="text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Distributions</summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          <DistBlock title="Direction" dist={data.direction_distribution} />
          <DistBlock title="Confidence" dist={data.confidence_distribution} />
          <DistBlock title="Market state" dist={data.market_state_distribution} />
          <DistBlock title="Sequence state" dist={data.sequence_state_distribution} />
          <DistBlock title="Volatility regime" dist={data.volatility_regime_distribution} />
          <DistBlock title="Psych role" dist={data.psych_level_role_distribution} />
          <DistBlock title="Status" dist={data.status_distribution} />
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  const tone = bad ? "text-red-400" : good ? "text-emerald-400" : "text-foreground";
  return (
    <div className="rounded border border-border/30 bg-muted/10 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono ${tone}`}>{value}</div>
    </div>
  );
}

function DistBlock({ title, dist }: { title: string; dist: Record<string, number> | null }) {
  if (!dist || Object.keys(dist).length === 0) return null;
  const total = Object.values(dist).reduce((a, b) => a + Number(b), 0) || 1;
  const entries = Object.entries(dist).sort((a, b) => Number(b[1]) - Number(a[1]));
  return (
    <div className="rounded border border-border/30 bg-muted/10 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between font-mono text-[11px]">
            <span className="truncate">{k}</span>
            <span className="text-muted-foreground">{Number(v)} ({((Number(v) / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
