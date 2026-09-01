import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Scissors } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  crossExitShadowBackfill,
  crossExitShadowStats,
} from "@/lib/opsManual/crossExitShadow.functions";

const cents = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : "+"}${Math.abs(n)}¢`;

export function OpsCrossExitShadowPanel() {
  const stats = useServerFn(crossExitShadowStats);
  const backfill = useServerFn(crossExitShadowBackfill);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const q = useQuery({
    queryKey: ["cross-exit-shadow-stats"],
    queryFn: () => stats({ data: { days: 14 } }),
    refetchInterval: 60_000,
  });

  const run = useMutation({
    mutationFn: () => backfill({ data: { startDate, endDate } }),
    onSuccess: (r) => {
      toast.success(`Backfilled ${r.processed} window(s)`);
      void q.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;

  return (
    <div className="border border-border bg-card rounded p-4 space-y-4">
      <div className="terminal-label flex items-center gap-2">
        <Scissors className="h-4 w-4" />
        // Cross-exit / late-flip shadow (last 14 days, no orders placed)
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        {[
          ["Windows", d ? String(d.rows) : "—"],
          ["Crossed strike", d ? `${d.crossed} (${d.wouldExit} exit)` : "—"],
          ["Would flip", d ? String(d.wouldFlip) : "—"],
          ["Settled", d ? String(d.settled) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="border border-border rounded p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
            <div className="text-sm font-bold">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {[
          ["Hold P/L", d?.holdPnlCents],
          ["Exit P/L", d?.exitPnlCents],
          ["Exit + flip P/L", d?.combinedPnlCents],
        ].map(([k, v]) => (
          <div key={k as string} className="border border-border rounded p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k as string}</div>
            <div
              className={
                (v as number | undefined) == null
                  ? "text-sm font-bold"
                  : (v as number) >= 0
                    ? "text-sm font-bold text-emerald-400"
                    : "text-sm font-bold text-red-400"
              }
            >
              {cents(v as number | undefined)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="block bg-background border border-border rounded px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="block bg-background border border-border rounded px-2 py-1 text-xs"
          />
        </label>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending || !startDate || !endDate}
          className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:bg-background disabled:opacity-50"
        >
          {run.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Backfill"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Rule under test: entry = market leader at T−5m; on any post-entry strike cross, sell at bid, and if
        the cross lands inside T−3m with the opposite side ≤ 40¢, buy the other side. Logged every 30s
        alongside the dense snapshot tick — it never places or cancels a real order.
      </p>
    </div>
  );
}
