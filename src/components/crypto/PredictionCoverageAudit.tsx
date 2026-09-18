// Read-only coverage audit for the prediction log.
// Flags windows that never got a btc_model_predictions row (logging only runs
// while the tick is live), so silent blind spots are visible immediately.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getPredictionCoverage } from "@/lib/cryptoPredictions.functions";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function PredictionCoverageAudit() {
  const fn = useServerFn(getPredictionCoverage);
  const q = useQuery({
    queryKey: ["btc-pred-coverage"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const d = q.data;
  const currentLate = !!d && !d.currentLogged && d.currentSecondsLeft <= 8 * 60;
  const bad = !!d && (currentLate || d.missing.length > 0);

  return (
    <div className={`border rounded-lg bg-card ${bad ? "border-amber-500/50" : "border-border"}`}>
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          {bad ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          )}
          Prediction log coverage (24h audit)
        </h2>
        {q.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {!d ? (
        <div className="p-4 text-sm text-muted-foreground">{q.isLoading ? "Checking…" : "No data."}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current window</div>
              <div className={`text-sm font-bold ${currentLate ? "text-amber-400" : d.currentLogged ? "text-emerald-400" : "text-muted-foreground"}`}>
                {d.currentLogged ? "Logged" : currentLate ? "NOT LOGGED" : "Pending"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                closes {fmt(d.currentClose)} · {Math.floor(d.currentSecondsLeft / 60)}m {d.currentSecondsLeft % 60}s left
              </div>
            </div>
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last logged</div>
              <div className="text-sm font-bold">{d.lastLoggedClose ? fmt(d.lastLoggedClose) : "—"}</div>
            </div>
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Coverage 24h</div>
              <div className={`text-sm font-bold ${d.logged24h === d.expected24h ? "text-emerald-400" : "text-amber-400"}`}>
                {d.logged24h} / {d.expected24h}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {d.expected24h ? `${Math.round((d.logged24h / d.expected24h) * 100)}% of windows` : ""}
              </div>
            </div>
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Missing</div>
              <div className={`text-sm font-bold ${d.missing.length ? "text-amber-400" : "text-emerald-400"}`}>
                {d.missing.length}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {d.longestGap > 1 ? `longest gap ${d.longestGap} windows` : "no long gap"}
              </div>
            </div>
          </div>

          {d.missing.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Windows with no prediction row (newest first)
              </div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {d.missing.map(m => (
                  <span key={m} className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300">
                    {fmt(m)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
