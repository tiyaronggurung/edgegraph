import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { captureClosingLine, getClvStats } from "@/lib/bets.functions";
import { StatCard } from "@/components/edge/StatCard";
import { toast } from "sonner";

type BetRow = {
  id: string;
  game: string | null;
  pick: string | null;
  sport: string | null;
  odds: number | null;
  closing_odds: number | null;
  clv_percent: number | null;
  result: string | null;
  created_at: string;
};

export function ClvLedger() {
  const qc = useQueryClient();
  const capture = useServerFn(captureClosingLine);
  const statsFn = useServerFn(getClvStats);

  const betsQ = useQuery({
    queryKey: ["bets-clv"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bets")
        .select("id, game, pick, sport, odds, closing_odds, clv_percent, result, created_at")
        .not("odds", "is", null)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as BetRow[];
    },
  });

  const statsQ = useQuery({
    queryKey: ["clv-stats"],
    queryFn: () => statsFn(),
  });

  const m = useMutation({
    mutationFn: (vars: { betId: string; closingOdds: number }) =>
      capture({ data: vars }),
    onSuccess: () => {
      toast.success("Closing line captured");
      qc.invalidateQueries({ queryKey: ["bets-clv"] });
      qc.invalidateQueries({ queryKey: ["clv-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = betsQ.data ?? [];
  const stats = statsQ.data ?? { avgClv: 0, captured: 0, positiveRate: 0 };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Avg CLV"
          value={`${stats.avgClv >= 0 ? "+" : ""}${stats.avgClv.toFixed(2)}%`}
          accent={stats.avgClv >= 0 ? "primary" : "danger"}
          sub="closing line value"
        />
        <StatCard
          label="CLV Captured"
          value={stats.captured}
          accent="info"
          sub="bets with closing line"
        />
        <StatCard
          label="Beat the Close"
          value={`${stats.positiveRate.toFixed(0)}%`}
          accent={stats.positiveRate >= 50 ? "primary" : "danger"}
          sub="bets with +CLV"
        />
      </div>

      <div className="border border-border bg-card rounded">
        <div className="p-4 border-b border-border">
          <h2 className="terminal-label">// CLV ledger</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Enter the closing odds (from any sportsbook or Kalshi at tip-off) to
            score whether you got better-than-market price. CLV is the only
            metric that proves edge before sample size is large enough for ROI.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider">
              <tr className="border-b border-border">
                <th className="text-left p-3">Game</th>
                <th className="text-left p-3">Pick</th>
                <th className="text-right p-3">Entry</th>
                <th className="text-right p-3">Close</th>
                <th className="text-right p-3">CLV</th>
                <th className="text-left p-3 w-44">Capture</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <BetRowView key={b.id} bet={b} onCapture={(v) => m.mutate({ betId: b.id, closingOdds: v })} />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No bets logged yet. Save a bet from the Live page to start tracking CLV.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BetRowView({ bet, onCapture }: { bet: BetRow; onCapture: (v: number) => void }) {
  const [val, setVal] = useState("");
  const captured = bet.closing_odds != null;
  const clv = Number(bet.clv_percent ?? 0);
  const entry = Number(bet.odds ?? 0);
  const isPM = entry > 0 && entry <= 1; // Kalshi / prediction-market price

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      <td className="p-3">
        <div className="text-foreground">{bet.game ?? "—"}</div>
        <div className="text-[10px] text-muted-foreground uppercase">{bet.sport ?? ""}</div>
      </td>
      <td className="p-3">{bet.pick ?? "—"}</td>
      <td className="p-3 text-right tabular-nums">{entry.toFixed(2)}</td>
      <td className="p-3 text-right tabular-nums">
        {captured ? Number(bet.closing_odds).toFixed(2) : <span className="text-muted-foreground">—</span>}
      </td>
      <td
        className={
          "p-3 text-right tabular-nums font-semibold " +
          (captured
            ? clv >= 0
              ? "text-[color:var(--color-primary)]"
              : "text-[color:var(--color-destructive)]"
            : "text-muted-foreground")
        }
      >
        {captured ? `${clv >= 0 ? "+" : ""}${clv.toFixed(2)}%` : "—"}
      </td>
      <td className="p-3">
        {captured ? (
          <span className="text-[10px] text-muted-foreground uppercase">locked</span>
        ) : (
          <div className="flex gap-1">
            <input
              type="number"
              step="0.01"
              min={isPM ? 0.01 : 1.01}
              max={isPM ? 1 : undefined}
              placeholder={isPM ? "0.77 or 77" : "e.g. 1.18"}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="w-20 px-2 py-1 bg-background border border-border rounded text-xs tabular-nums"
            />
            <button
              onClick={() => {
                let n = parseFloat(val);
                if (!Number.isFinite(n)) {
                  toast.error("Enter a number");
                  return;
                }
                if (isPM) {
                  // Accept percent (1-100) or decimal (0.01-1.00)
                  if (n > 1) n = n / 100;
                  if (n <= 0 || n > 1) {
                    toast.error("Closing price must be between 0.01 and 1.00 (or 1–100%)");
                    return;
                  }
                } else {
                  if (n < 1.01) {
                    toast.error("Enter decimal odds ≥ 1.01");
                    return;
                  }
                }
                onCapture(n);
              }}
              className="px-2 py-1 text-[10px] uppercase tracking-wider border border-[color:var(--color-primary)] text-[color:var(--color-primary)] rounded hover:bg-[color:var(--color-primary)]/10"
            >
              Lock
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
