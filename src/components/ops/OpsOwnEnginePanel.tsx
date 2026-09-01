// Own Model engine panel — arm/disarm, paper/live, live window state,
// the exact contract count we'd buy, plus order and skip feeds.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cpu, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getOwnEngineState, saveOwnEngineSettings, ownEngineTick,
  listOwnEngineOrders, listOwnEngineSkips,
} from "@/lib/ownModel/ownEngine.functions";
import { cn } from "@/lib/utils";

const money = (c: number | null | undefined) =>
  c == null ? "—" : `${c < 0 ? "-" : ""}$${Math.abs(c / 100).toFixed(2)}`;

const clock = (s: number | null | undefined) => {
  if (s == null || s < 0) return "--:--";
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function OpsOwnEnginePanel() {
  const qc = useQueryClient();
  const stateFn = useServerFn(getOwnEngineState);
  const saveFn = useServerFn(saveOwnEngineSettings);
  const tickFn = useServerFn(ownEngineTick);
  const ordersFn = useServerFn(listOwnEngineOrders);
  const skipsFn = useServerFn(listOwnEngineSkips);
  const [tab, setTab] = useState<"orders" | "skips">("orders");
  const [lastTick, setLastTick] = useState<string | null>(null);

  const st = useQuery({ queryKey: ["own-engine-state"], queryFn: () => stateFn(), refetchInterval: 5_000 });
  const orders = useQuery({ queryKey: ["own-engine-orders"], queryFn: () => ordersFn({ data: { limit: 60 } }), refetchInterval: 20_000 });
  const skips = useQuery({ queryKey: ["own-engine-skips"], queryFn: () => skipsFn({ data: { limit: 60 } }), refetchInterval: 20_000 });

  // Engine loop: one pass every 15s (settle → exits → entry).
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const r = await tickFn({});
        if (!alive) return;
        setLastTick(
          "ok" in r && r.ok
            ? `${(r as any).fills?.length ? (r as any).fills.join(", ") : (r as any).decision?.reason ?? "idle"}`
            : (r as any).error ?? "no market",
        );
        qc.invalidateQueries({ queryKey: ["own-engine-orders"] });
        qc.invalidateQueries({ queryKey: ["own-engine-skips"] });
        qc.invalidateQueries({ queryKey: ["own-engine-state"] });
      } catch { /* best effort */ }
    };
    void run();
    const t = setInterval(run, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [tickFn, qc]);

  const s = st.data;
  const set = s?.settings;
  const d = s?.decision;

  const patch = async (p: { armed?: boolean; paper?: boolean; bankrollCents?: number }) => {
    const r = await saveFn({ data: p });
    if (!r.ok) toast.error(r.error);
    else { toast.success("saved"); void st.refetch(); }
  };

  return (
    <section className="border border-border rounded-lg p-4 space-y-4 font-mono">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[color:var(--color-primary)]" />
          <h2 className="text-sm font-bold uppercase tracking-widest">
            // Own model engine — BTC 15m {s?.version ? `(${s.version})` : ""}
          </h2>
        </div>
        <button onClick={() => { void st.refetch(); void orders.refetch(); void skips.refetch(); }}
          className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      {/* arm / mode / bankroll */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <button
          onClick={() => patch({ armed: !set?.armed })}
          className={cn("border rounded px-3 py-1 uppercase tracking-widest",
            set?.armed ? "border-emerald-500 text-emerald-400" : "border-border text-muted-foreground")}
        >
          {set?.armed ? "Armed" : "Disarmed"}
        </button>
        <span className={cn("uppercase tracking-widest", set?.paper ? "text-sky-400" : "text-red-400")}>
          {set?.paper ? "Paper mode" : "LIVE mode"}
        </span>
        <label className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Bankroll $</span>
          <input
            defaultValue={set ? (set.bankrollCents / 100).toFixed(0) : ""}
            onBlur={(e) => {
              const v = Math.round(Number(e.target.value) * 100);
              if (Number.isFinite(v) && v >= 10_000) void patch({ bankrollCents: v });
            }}
            className="w-24 bg-background border border-border rounded px-2 py-1"
          />
        </label>
        <span className="text-muted-foreground">
          Risk {set?.riskPerTradePct ?? 1}% · band {set?.minPriceCents}–{set?.maxPriceCents}¢ · edge ≥{set?.minEdgeCents}¢
        </span>
      </div>

      {/* live window */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
        <Cell label="Strike" v={s?.strike != null ? `$${s.strike.toLocaleString()}` : "—"} />
        <Cell label="Spot" v={s?.spot != null ? `$${s.spot.toLocaleString()}` : "—"} />
        <Cell label="Cushion" v={s?.cushionUsd != null ? `${s.cushionUsd >= 0 ? "+" : ""}$${s.cushionUsd.toFixed(0)}` : "—"} />
        <Cell label="Time left" v={clock(s?.secondsLeft)} />
        <Cell label="P(up)" v={s?.probUp != null ? `${(s.probUp * 100).toFixed(1)}%` : "—"} />
        <Cell label="Exp. move" v={s?.expectedMoveUsd != null ? `$${s.expectedMoveUsd.toFixed(0)}` : "—"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
        <Cell label="UP ask" v={s?.up.askCents != null ? `${s.up.askCents}¢` : "—"} />
        <Cell label="DOWN ask" v={s?.down.askCents != null ? `${s.down.askCents}¢` : "—"} />
        <Cell label="Vol 1m" v={s ? `${(s.vol1m * 100).toFixed(3)}%` : "—"} />
        <Cell label="Drift/min" v={s ? `$${s.driftUsdPerMin.toFixed(1)}` : "—"} />
        <Cell label="Cash" v={money(s?.equity.cashCents)} />
        <Cell label="Realized P/L" v={money(s?.equity.realizedCents)} tone={(s?.equity.realizedCents ?? 0) >= 0 ? "good" : "bad"} />
      </div>

      {/* THE decision — how many contracts */}
      <div className={cn("border rounded p-3 text-xs space-y-1",
        d?.action === "SKIP" || !d ? "border-border" : "border-emerald-500/70")}>
        <div className="uppercase tracking-widest text-[10px] text-muted-foreground">Decision right now</div>
        {!d && <div className="text-muted-foreground">{s?.error ?? "waiting for a live window…"}</div>}
        {d && d.action === "PAIR_LOCK" && d.pair && (
          <div className="text-emerald-400 font-bold">
            PAIR LOCK — buy {d.pair.contracts} UP @ {d.pair.upCents}¢ AND {d.pair.contracts} DOWN @ {d.pair.downCents}¢
            <span className="text-muted-foreground font-normal"> · locked {money(d.pair.lockedProfitCents)}</span>
          </div>
        )}
        {d && (d.action === "DIRECTIONAL" || d.action === "STACK") && (
          <div className="text-emerald-400 font-bold">
            {d.action} — buy <span className="text-lg">{d.contracts}</span> contracts {d.side === "YES" ? "UP" : "DOWN"} @ {d.priceCents}¢
            <span className="text-muted-foreground font-normal">
              {" "}· cost {money((d.contracts ?? 0) * (d.priceCents ?? 0))} · edge {d.edgeCents?.toFixed(1)}¢
            </span>
          </div>
        )}
        {d && d.action === "SKIP" && (
          <div><span className="text-amber-400 font-bold">{d.code}</span> <span className="text-muted-foreground">— {d.reason}</span></div>
        )}
        <div className="text-muted-foreground">
          z {d?.z?.toFixed(2) ?? "—"} · model P(up) {d ? `${(d.modelProbUp * 100).toFixed(1)}%` : "—"} · last pass: {lastTick ?? "—"}
        </div>
      </div>

      {/* position trading log — aggregated fills, mark-to-market */}
      <PositionLog
        orders={orders.data ?? []}
        skips={skips.data ?? []}
        ticker={s?.ticker ?? null}
        up={s?.up ?? null}
        down={s?.down ?? null}
      />

      {/* feeds */}
      <div className="flex gap-1 border-b border-border">
        {([["orders", `Orders (${orders.data?.length ?? 0})`], ["skips", `Skips (${skips.data?.length ?? 0})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn("px-3 py-1.5 text-[10px] uppercase tracking-widest border-b-2 -mb-px",
              tab === k ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}
      </div>

      {tab === "orders" && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground uppercase tracking-widest">
              <tr className="text-left"><th className="py-1">Time</th><th>Phase</th><th>Side</th><th>Qty</th><th>Price</th><th>Edge</th><th>Status</th><th className="text-right">P/L</th></tr>
            </thead>
            <tbody>
              {(orders.data ?? []).length === 0 && <tr><td colSpan={8} className="py-2 text-muted-foreground">No engine orders yet.</td></tr>}
              {(orders.data ?? []).map((o) => (
                <tr key={o.id} className="border-t border-border/50">
                  <td className="py-1">{new Date(o.created_at).toISOString().slice(11, 19)}Z</td>
                  <td className="uppercase">{o.phase}</td>
                  <td>{o.side === "YES" ? "UP" : "DOWN"}</td>
                  <td>{o.contracts}</td>
                  <td>{o.price_cents}¢</td>
                  <td>{o.edge_cents != null ? `${Number(o.edge_cents).toFixed(1)}¢` : "—"}</td>
                  <td>{o.status}{o.paper ? "" : " · LIVE"}</td>
                  <td className={cn("text-right", (o.pnl_cents ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>{o.pnl_cents == null ? "—" : money(o.pnl_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "skips" && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground uppercase tracking-widest">
              <tr className="text-left"><th className="py-1">Time</th><th>Code</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {(skips.data ?? []).length === 0 && <tr><td colSpan={3} className="py-2 text-muted-foreground">No refusals logged yet.</td></tr>}
              {(skips.data ?? []).map((k) => (
                <tr key={k.id} className="border-t border-border/50">
                  <td className="py-1">{new Date(k.created_at).toISOString().slice(11, 19)}Z</td>
                  <td className="text-amber-400 font-bold">{k.code}</td>
                  <td className="text-muted-foreground">{k.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Contracts = floor(bankroll × {set?.riskPerTradePct ?? 1}% ÷ ask price), capped at ${set?.perSideWindowCapUsd ?? 300}/side/window
        and by free cash. Pair locks buy equal legs when UP+DOWN+fees ≤ {set?.maxPairCostCents ?? 96}¢ and are held to settlement.
        Exits bank at {set?.exitCapturePct ?? 92}% capture or stop out at half cost once the model flips. Paper mode never sends a real order.
      </p>
    </section>
  );
}

function Cell({ label, v, tone }: { label: string; v: string; tone?: "good" | "bad" }) {
  return (
    <div className="border border-border/60 rounded px-2 py-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold truncate", tone === "good" && "text-emerald-400", tone === "bad" && "text-red-400")}>{v}</div>
    </div>
  );
}
