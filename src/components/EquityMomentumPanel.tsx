import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { getEquitySignal, type EquitySymbolSignal } from "@/lib/equityMomentum.functions";

function dirIcon(d: EquitySymbolSignal["direction"]) {
  if (d === "up") return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (d === "down") return <TrendingDown className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function pctClass(v: number | null) {
  if (v == null) return "text-muted-foreground";
  return v > 0.01 ? "text-emerald-400" : v < -0.01 ? "text-red-400" : "text-muted-foreground";
}

function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)}%`;
}

export function EquityMomentumPanel() {
  const fn = useServerFn(getEquitySignal);
  const q = useQuery({
    queryKey: ["equity-signal"],
    queryFn: () => fn(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const d = q.data;

  const regimeColor =
    d?.regime === "risk_on" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : d?.regime === "risk_off" ? "bg-red-500/15 text-red-400 border-red-500/30"
    : "bg-muted/30 text-muted-foreground border-border";

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" />
            Equity momentum · leading indicator
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
              SIGNAL ONLY
            </span>
          </h2>
          <p className="text-[11px] text-muted-foreground">
            SPY/QQQ 1-min candles often lead BTC by 10–30s. Displayed for verification — not yet wired into auto-trade.
          </p>
        </div>
        {d && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider font-semibold ${regimeColor}`}>
              {d.regime.replace("_", " ")} · {d.strength}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">
              score {d.score >= 0 ? "+" : ""}{d.score.toFixed(3)}% · σ {d.sigma.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      <div className="p-3">
        {q.isLoading && <div className="text-xs text-muted-foreground">Loading equity feed…</div>}
        {q.error && <div className="text-xs text-red-400">Failed to load equity signal.</div>}
        {d && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {d.symbols.map(s => (
                <div key={s.symbol} className="border border-border/60 rounded p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{s.label}</div>
                    {dirIcon(s.direction)}
                  </div>
                  {s.available ? (
                    <>
                      <div className="font-mono text-sm">{s.price != null ? s.price.toFixed(2) : "—"}</div>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">30s</div>
                          <div className={`font-mono text-[11px] ${pctClass(s.ret30sPct)}`}>{fmtPct(s.ret30sPct)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">1m</div>
                          <div className={`font-mono text-[11px] ${pctClass(s.ret1mPct)}`}>{fmtPct(s.ret1mPct)}</div>
                        </div>
                      </div>
                      {s.sigma != null && (
                        <div className="text-[10px] text-muted-foreground mt-1 font-mono">σ {s.sigma >= 0 ? "+" : ""}{s.sigma.toFixed(2)}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      unavailable {s.note ? `· ${s.note}` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground border-t border-border/60 pt-2">
              <span className="font-semibold text-foreground">Hypothetical BTC impact: </span>
              {d.btcImpact.explanation}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
