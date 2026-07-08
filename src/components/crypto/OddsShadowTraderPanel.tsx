import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { runOddsShadowTick, getOddsShadowReport } from "@/lib/oddsShadowTrader.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, TrendingUp, TrendingDown } from "lucide-react";

// SHADOW-ONLY. Runs the odds-flip trader every 5s, logs decisions, shows PnL vs actuals.
// No real orders are placed.

export function OddsShadowTraderPanel() {
  const tick = useServerFn(runOddsShadowTick);
  const report = useServerFn(getOddsShadowReport);

  const runTick = useMutation({ mutationFn: () => tick() });
  const { data } = useQuery({
    queryKey: ["oddsShadowReport"],
    queryFn: () => report(),
    refetchInterval: 5_000,
  });

  const tickRef = useRef(runTick);
  tickRef.current = runTick;
  useEffect(() => {
    // Fire every 5s while panel is mounted.
    const id = setInterval(() => {
      tickRef.current.mutate();
    }, 5_000);
    // Kick off immediately.
    tickRef.current.mutate();
    return () => clearInterval(id);
  }, []);

  const r = data && data.ok ? data : null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Odds-Flip Shadow Trader <span className="text-muted-foreground font-normal">· 5s tick</span></h3>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Pure-Kalshi-odds logic. leader_chase (T-4m, stable, 60-90¢) + flip_fade (post-T-10m flip, ≥55¢). Paper only.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {runTick.isPending ? "ticking…" : runTick.isError ? "err" : "live"}
        </Badge>
      </div>

      {r && r.bankroll && (
        <div className={`rounded border p-2 text-[11px] ${r.bankroll.mode === "profit" ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Bankroll</span>
              <Badge variant={r.bankroll.mode === "profit" ? "default" : "outline"} className="text-[9px]">
                {r.bankroll.mode === "profit" ? "PLAYING WITH PROFIT" : "BASE $100"}
              </Badge>
            </div>
            <div className="font-mono">
              bank <span className={r.bankroll.bank >= 0 ? "text-emerald-400" : "text-red-400"}>${r.bankroll.bank.toFixed(2)}</span>
              {" · "}next stake <span className="font-semibold">${r.bankroll.nextStake.toFixed(2)}</span>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Unlock at ≥${r.bankroll.unlockThreshold} over last 3 trades. Once unlocked, stake = {r.bankroll.stakePct}% of profit bank (min $100, cap $500).
          </div>
        </div>
      )}

      {r && (
        <>
          <div className="grid grid-cols-5 gap-2 text-center">
            <div className="rounded border p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Fired</div>
              <div className="text-lg font-semibold">{r.totals.fired}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Record</div>
              <div className="text-lg font-semibold">{r.totals.wins}W / {r.totals.losses}L</div>
              <div className="text-[10px] text-muted-foreground">{r.totals.winPct}%</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">PnL</div>
              <div className={`text-lg font-semibold ${r.totals.pnlUsd > 0 ? "text-emerald-400" : r.totals.pnlUsd < 0 ? "text-red-400" : ""}`}>
                ${r.totals.pnlUsd.toFixed(2)}
              </div>
            </div>
            <div className="rounded border p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Early exits</div>
              <div className="text-lg font-semibold">{r.totals.earlyExits ?? 0}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Open</div>
              <div className="text-lg font-semibold">{r.totals.fired - r.totals.settled}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border p-2">
              <div className="font-semibold flex items-center gap-1 mb-1"><TrendingUp className="h-3 w-3" />leader_chase</div>
              <div className="font-mono">{r.byTrigger.leader_chase.wins}W / {r.byTrigger.leader_chase.settled - r.byTrigger.leader_chase.wins}L · ${r.byTrigger.leader_chase.pnl.toFixed(2)}</div>
              <div className="text-[10px] text-muted-foreground">fired {r.byTrigger.leader_chase.fired} · settled {r.byTrigger.leader_chase.settled}</div>
            </div>
            <div className="rounded border p-2">
              <div className="font-semibold flex items-center gap-1 mb-1"><Zap className="h-3 w-3" />flip_fade</div>
              <div className="font-mono">{r.byTrigger.flip_fade.wins}W / {r.byTrigger.flip_fade.settled - r.byTrigger.flip_fade.wins}L · ${r.byTrigger.flip_fade.pnl.toFixed(2)}</div>
              <div className="text-[10px] text-muted-foreground">fired {r.byTrigger.flip_fade.fired} · settled {r.byTrigger.flip_fade.settled}</div>
            </div>
          </div>

          {r.calibration && r.calibration.length > 0 && (
            <div className="rounded border p-2 text-[11px]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Auto-tuned thresholds</div>
              <div className="grid grid-cols-2 gap-2 font-mono">
                {r.calibration.map((c) => (
                  <div key={c.trigger}>
                    <span className="text-muted-foreground">{c.trigger}:</span> {c.min_cents}-{c.max_cents}¢ · v≥{c.min_velocity} · n={c.sample_size} · {Math.round(Number(c.win_rate) * 100)}%
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.skipTop && r.skipTop.length > 0 && (
            <div className="rounded border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1 border-b">Top skip reasons (24h)</div>
              <div className="px-2 py-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono">
                {r.skipTop.map((s) => (
                  <div key={s.key} className="flex justify-between">
                    <span className="truncate text-muted-foreground">{s.key}</span>
                    <span>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.regressionSkips && r.regressionSkips.length > 0 && (
            <div className="rounded border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1 border-b">
                Regression chop skips (24h) · slope/R² on 15-min tape
              </div>
              <div className="max-h-56 overflow-y-auto divide-y">
                {r.regressionSkips.map((s, i) => {
                  const d = (s.detail ?? {}) as { slope_yes?: number; slope_no?: number; r2_yes?: number; r2?: number; points?: number };
                  const reasonLabel = s.reason.replace("regression_", "");
                  return (
                    <div key={i} className="px-2 py-1 text-[11px] font-mono">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{s.ticker.slice(-16)}</span>
                        <Badge variant="outline" className="text-[9px]">{reasonLabel}</Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3">
                        <span>YES {s.yes_cents ?? "-"}¢ / NO {s.no_cents ?? "-"}¢</span>
                        {d.slope_yes !== undefined && <span>sYES {Number(d.slope_yes).toFixed(2)}¢/m</span>}
                        {d.slope_no !== undefined && <span>sNO {Number(d.slope_no).toFixed(2)}¢/m</span>}
                        {(d.r2_yes ?? d.r2) !== undefined && <span>R² {Number(d.r2_yes ?? d.r2).toFixed(2)}</span>}
                        {d.points !== undefined && <span>n={d.points}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {r.recent.length > 0 && (
            <div className="rounded border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1 border-b">Recent shadow fires</div>
              <div className="max-h-56 overflow-y-auto divide-y">
                {r.recent.map(row => (
                  <div key={row.id} className="px-2 py-1 flex items-center justify-between gap-2 text-[11px] font-mono">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {row.side === "YES" ? <TrendingUp className="h-3 w-3 text-emerald-400" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
                      <span className="truncate">{row.ticker.slice(-16)}</span>
                      <Badge variant="outline" className="text-[9px]">{row.trigger === "leader_chase" ? "chase" : "fade"}</Badge>
                      {row.early_exited && <Badge variant="destructive" className="text-[9px]">exit</Badge>}
                      {Number(row.rotation_index ?? 0) === 1 && <Badge className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40">rotated</Badge>}
                      {Number(row.rotation_index ?? 0) === 2 && <Badge className="text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">re-entry</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{row.limit_cents}¢×{row.contracts}</span>
                      {row.settled ? (
                        <span className={row.won ? "text-emerald-400" : "text-red-400"}>
                          {row.won ? "+" : ""}${Number(row.pnl_usd ?? 0).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">open</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
