import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { StatCard } from "@/components/edge/StatCard";
import { Check, X, Minus, Loader2, DollarSign, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { settlePendingKalshiBets } from "@/lib/bets.functions";


type Row = {
  id: string;
  created_at: string;
  market_ticker: string;
  market_title: string | null;
  side: string;
  side_label: string | null;
  fair_prob: number | null;
  market_prob: number | null;
  edge_pts: number | null;
  pattern: string | null;
  kelly_half: number | null;
  verdict: string;
  result: string;
  resolved_at: string | null;
  bet_id: string | null;
};

type Bet = {
  id: string;
  stake: number | null;
  profit_loss: number | null;
  odds: number | null;
  result: string | null;
};

const RESULT_FILTERS = ["All", "Pending", "WIN", "LOSS", "VOID"] as const;
type ResultFilter = (typeof RESULT_FILTERS)[number];

export function VerdictLogTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const settleFn = useServerFn(settlePendingKalshiBets);
  const [filter, setFilter] = useState<ResultFilter>("All");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logRow, setLogRow] = useState<Row | null>(null);
  const [stakeInput, setStakeInput] = useState("");
  const [oddsInput, setOddsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [settling, setSettling] = useState(false);

  async function autoSettle() {
    setSettling(true);
    try {
      const res = await settleFn();
      if (res.settled > 0) {
        toast.success(`Settled ${res.settled} of ${res.checked} pending bets`);
        qc.invalidateQueries({ queryKey: ["verdict-log", user?.id] });
        qc.invalidateQueries({ queryKey: ["verdict-log-bets", user?.id] });
        qc.invalidateQueries({ queryKey: ["bankroll-stats"] });
      } else {
        toast.info(`Checked ${res.checked} pending — none resolved yet`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSettling(false);
    }
  }


  const q = useQuery({
    queryKey: ["verdict-log", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("verdict_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    enabled: !!user,
  });

  const rows = q.data ?? [];
  const betIds = useMemo(
    () => rows.map((r) => r.bet_id).filter((x): x is string => !!x),
    [rows],
  );

  const betsQ = useQuery({
    queryKey: ["verdict-log-bets", user?.id, betIds.join(",")],
    queryFn: async () => {
      if (betIds.length === 0) return {} as Record<string, Bet>;
      const { data, error } = await supabase
        .from("bets")
        .select("id, stake, profit_loss, odds, result")
        .in("id", betIds);
      if (error) throw error;
      const map: Record<string, Bet> = {};
      for (const b of (data ?? []) as Bet[]) map[b.id] = b;
      return map;
    },
    enabled: !!user && betIds.length > 0,
  });

  const betsById = betsQ.data ?? {};

  const filtered = useMemo(
    () => (filter === "All" ? rows : rows.filter((r) => r.result === filter)),
    [rows, filter],
  );

  const stats = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.result === "Pending").length;
    const wins = rows.filter((r) => r.result === "WIN").length;
    const losses = rows.filter((r) => r.result === "LOSS").length;
    const decided = wins + losses;
    const hitRate = decided > 0 ? wins / decided : 0;
    let staked = 0;
    let pl = 0;
    for (const r of rows) {
      if (!r.bet_id) continue;
      const b = betsById[r.bet_id];
      if (!b) continue;
      staked += Number(b.stake ?? 0);
      pl += Number(b.profit_loss ?? 0);
    }
    const roi = staked > 0 ? (pl / staked) * 100 : 0;
    return { total, pending, wins, losses, hitRate, staked, pl, roi };
  }, [rows, betsById]);

  async function setResult(row: Row, result: "WIN" | "LOSS" | "VOID" | "Pending") {
    setBusyId(row.id);
    const patch =
      result === "Pending"
        ? { result, resolved_at: null }
        : { result, resolved_at: new Date().toISOString() };
    const { error } = await supabase.from("verdict_log").update(patch).eq("id", row.id);

    // Sync linked bet (if any) so money P/L updates automatically.
    if (!error && row.bet_id) {
      const bet = betsById[row.bet_id];
      const stake = Number(bet?.stake ?? 0);
      const odds = Number(bet?.odds ?? 0); // stored as 0..1 share price
      let profit_loss = 0;
      let betResult: string = "Pending";
      if (result === "WIN") {
        betResult = "Win";
        // Kalshi-style: payoff per $1 risked = (1 - price) / price
        profit_loss = odds > 0 && odds < 1 ? stake * ((1 - odds) / odds) : 0;
      } else if (result === "LOSS") {
        betResult = "Loss";
        profit_loss = -stake;
      } else if (result === "VOID") {
        betResult = "Push";
        profit_loss = 0;
      }
      await supabase
        .from("bets")
        .update({ result: betResult, profit_loss })
        .eq("id", row.bet_id);
    }

    setBusyId(null);
    if (error) {
      toast.error(`Failed to update: ${error.message}`);
      return;
    }
    qc.invalidateQueries({ queryKey: ["verdict-log", user?.id] });
    qc.invalidateQueries({ queryKey: ["verdict-log-bets", user?.id] });
  }

  function openLogDialog(row: Row) {
    setLogRow(row);
    // Prefill: ½K stake if present, market price for odds
    setStakeInput(row.kelly_half != null ? String(Math.round(Number(row.kelly_half))) : "");
    setOddsInput(
      row.market_prob != null ? (Number(row.market_prob) / 100).toFixed(2) : "",
    );
  }

  async function submitLogBet() {
    if (!logRow || !user) return;
    const stake = Number(stakeInput);
    const odds = Number(oddsInput);
    if (!Number.isFinite(stake) || stake <= 0) {
      toast.error("Enter a valid stake");
      return;
    }
    if (!Number.isFinite(odds) || odds <= 0 || odds >= 1) {
      toast.error("Odds must be a share price between 0 and 1 (e.g. 0.52)");
      return;
    }
    setSubmitting(true);
    const { data: bet, error: insErr } = await supabase
      .from("bets")
      .insert({
        user_id: user.id,
        game: logRow.market_title ?? logRow.market_ticker,
        pick: `${logRow.side_label ?? logRow.side} (${logRow.market_ticker})`,
        sport: "Kalshi",
        odds,
        stake,
        pattern_type: logRow.pattern,
        edge_score: logRow.edge_pts ?? null,
        result: "Pending",
        notes: `Auto-linked from verdict log`,
      })
      .select("id")
      .single();

    if (insErr || !bet) {
      setSubmitting(false);
      toast.error(`Failed to log bet: ${insErr?.message ?? "unknown error"}`);
      return;
    }
    const { error: linkErr } = await supabase
      .from("verdict_log")
      .update({ bet_id: bet.id })
      .eq("id", logRow.id);
    setSubmitting(false);
    if (linkErr) {
      toast.error(`Linked, but link save failed: ${linkErr.message}`);
      return;
    }
    toast.success(`Bet logged: $${stake} @ ${odds}`);
    setLogRow(null);
    qc.invalidateQueries({ queryKey: ["verdict-log", user?.id] });
    qc.invalidateQueries({ queryKey: ["verdict-log-bets", user?.id] });
  }

  if (!user) {
    return (
      <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
        Sign in to track verdicts.
      </div>
    );
  }

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading verdict log…</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Every BET verdict shown on /live is auto-logged here. Click <strong>Log Bet</strong> to
        attach a real stake — P/L is then tracked automatically when you mark WIN / LOSS / VOID.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Tracked" value={stats.total.toLocaleString()} accent="info" />
        <StatCard label="Pending" value={stats.pending.toLocaleString()} accent="warning" />
        <StatCard
          label="Hit rate"
          value={`${(stats.hitRate * 100).toFixed(1)}%`}
          accent={stats.hitRate >= 0.5 ? "primary" : "danger"}
          sub={`${stats.wins}W / ${stats.losses}L`}
        />
        <StatCard label="Staked" value={`$${stats.staked.toFixed(0)}`} accent="info" />
        <StatCard
          label="P/L"
          value={`${stats.pl >= 0 ? "+" : ""}$${stats.pl.toFixed(2)}`}
          accent={stats.pl >= 0 ? "primary" : "danger"}
        />
        <StatCard
          label="ROI"
          value={`${stats.roi >= 0 ? "+" : ""}${stats.roi.toFixed(1)}%`}
          accent={stats.roi >= 0 ? "primary" : "danger"}
        />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {RESULT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border ${
              filter === f
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={autoSettle}
          disabled={settling || stats.pending === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider rounded border border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] disabled:opacity-50"
          title="Check Kalshi for resolved markets and auto-mark WIN/LOSS"
        >
          {settling ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Auto-settle Kalshi
        </button>
      </div>


      {filtered.length === 0 ? (
        <div className="border border-border bg-card rounded p-6 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No verdicts logged yet. Open /live and let a BET verdict appear — it logs automatically."
            : "No rows match this filter."}
        </div>
      ) : (
        <section className="border border-border bg-card rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground uppercase tracking-widest text-[10px]">
                <tr>
                  <th className="text-left p-2">Logged</th>
                  <th className="text-left p-2">Market</th>
                  <th className="text-left p-2">Side</th>
                  <th className="text-right p-2">Fair</th>
                  <th className="text-right p-2">Edge</th>
                  <th className="text-right p-2">Stake</th>
                  <th className="text-right p-2">P/L</th>
                  <th className="text-center p-2">Result</th>
                  <th className="text-right p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const tone =
                    r.result === "WIN"
                      ? "text-emerald-400"
                      : r.result === "LOSS"
                        ? "text-red-400"
                        : r.result === "VOID"
                          ? "text-muted-foreground"
                          : "text-amber-400";
                  const bet = r.bet_id ? betsById[r.bet_id] : null;
                  const stake = bet ? Number(bet.stake ?? 0) : null;
                  const pl = bet ? Number(bet.profit_loss ?? 0) : null;
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-2 max-w-[200px]">
                        <div className="truncate font-medium">{r.market_title ?? r.market_ticker}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {r.market_ticker}
                        </div>
                      </td>
                      <td className="p-2">{r.side_label ?? r.side}</td>
                      <td className="p-2 text-right tabular-nums">
                        {r.fair_prob != null ? `${Number(r.fair_prob).toFixed(0)}%` : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {r.edge_pts != null ? `+${Number(r.edge_pts).toFixed(1)}` : "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {stake != null ? `$${stake.toFixed(0)}` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums font-medium ${
                          pl == null
                            ? "text-muted-foreground"
                            : pl > 0
                              ? "text-emerald-400"
                              : pl < 0
                                ? "text-red-400"
                                : "text-muted-foreground"
                        }`}
                      >
                        {pl != null ? `${pl >= 0 ? "+" : ""}$${pl.toFixed(2)}` : "—"}
                      </td>
                      <td className={`p-2 text-center font-bold uppercase tracking-widest ${tone}`}>
                        {r.result}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-end items-center">
                          {!r.bet_id && (
                            <button
                              onClick={() => openLogDialog(r)}
                              title="Log a real bet linked to this verdict"
                              className="p-1 rounded border border-border hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
                            >
                              <DollarSign className="h-3 w-3" />
                            </button>
                          )}
                          {busyId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : r.result === "Pending" ? (
                            <>
                              <button
                                onClick={() => setResult(r, "WIN")}
                                title="Mark WIN"
                                className="p-1 rounded border border-border hover:border-emerald-500 hover:text-emerald-400"
                              >
                                <Check className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setResult(r, "LOSS")}
                                title="Mark LOSS"
                                className="p-1 rounded border border-border hover:border-red-500 hover:text-red-400"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setResult(r, "VOID")}
                                title="Mark VOID"
                                className="p-1 rounded border border-border hover:border-muted-foreground hover:text-muted-foreground"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setResult(r, "Pending")}
                              title="Reset to Pending"
                              className="text-[10px] text-muted-foreground hover:text-foreground underline"
                            >
                              undo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Dialog open={!!logRow} onOpenChange={(o) => !o && setLogRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log bet for this verdict</DialogTitle>
          </DialogHeader>
          {logRow && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{logRow.market_title ?? logRow.market_ticker}</div>
                <div>Side: {logRow.side_label ?? logRow.side}</div>
                <div>Pattern: {logRow.pattern ?? "—"}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="stake">Stake ($)</Label>
                  <Input
                    id="stake"
                    type="number"
                    inputMode="decimal"
                    value={stakeInput}
                    onChange={(e) => setStakeInput(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">Prefilled with ½-Kelly</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="odds">Entry price (0–1)</Label>
                  <Input
                    id="odds"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    max="0.99"
                    value={oddsInput}
                    onChange={(e) => setOddsInput(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">Kalshi share price</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogRow(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitLogBet} disabled={submitting}>
              {submitting ? "Saving…" : "Log bet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
