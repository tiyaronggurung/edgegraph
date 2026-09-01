// Paper-money Kalshi 15m trader: live strike, UP/DOWN prices, countdown,
// entry, hedge (two-sided engine), exit and flip-side detection.
// Everything here is simulated — no real order ever leaves this panel.
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, TrendingUp, TrendingDown, Shield, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getPaperKalshiWindow,
  listPaperKalshiPositions,
  paperKalshiEnter,
  paperKalshiExit,
  paperKalshiHedge,
  paperKalshiFlipWatch,
  paperKalshiAutoHedgeTick,
  paperKalshiSetAutoHedge,
  listPaperKalshiEvents,
  settlePaperKalshiPositions,
  paperKalshiAutoBuyTick,
  type PaperKalshiPosition,
  type PaperKalshiEvent,
} from "@/lib/paperKalshi.functions";
import { OpsPaperPnlChart } from "@/components/ops/OpsPaperPnlChart";
import { cn } from "@/lib/utils";

const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `${cents < 0 ? "-" : "+"}$${Math.abs(cents / 100).toFixed(2)}`;

const clock = (s: number | null) => {
  if (s == null || s < 0) return "--:--";
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function OpsPaperTradePanel() {
  const qc = useQueryClient();
  const getWindow = useServerFn(getPaperKalshiWindow);
  const listFn = useServerFn(listPaperKalshiPositions);
  const enterFn = useServerFn(paperKalshiEnter);
  const hedgeFn = useServerFn(paperKalshiHedge);
  const exitFn = useServerFn(paperKalshiExit);
  const flipFn = useServerFn(paperKalshiFlipWatch);
  const settleFn = useServerFn(settlePaperKalshiPositions);
  const autoHedgeTick = useServerFn(paperKalshiAutoHedgeTick);
  const setAutoHedgeFn = useServerFn(paperKalshiSetAutoHedge);
  const eventsFn = useServerFn(listPaperKalshiEvents);
  const autoBuyTick = useServerFn(paperKalshiAutoBuyTick);

  const [contracts, setContracts] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [autoHedge, setAutoHedge] = useState(true);
  const [tab, setTab] = useState<"holdings" | "activity" | "transactions">("holdings");
  const [autoBuyStatus, setAutoBuyStatus] = useState<string | null>(null);

  const win = useQuery({
    queryKey: ["paper-kalshi-window"],
    queryFn: () => getWindow(),
    refetchInterval: 3_000,
  });

  const positions = useQuery({
    queryKey: ["paper-kalshi-positions"],
    queryFn: () => listFn({ data: { limit: 50 } }),
    refetchInterval: 15_000,
  });

  // Local 1s countdown between 3s server refreshes.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const events = useQuery({
    queryKey: ["paper-kalshi-events"],
    queryFn: () => eventsFn({ data: { limit: 200 } }),
    refetchInterval: 15_000,
  });

  // Flip watch + auto-hedge + settlement sweep, every 20s.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        await flipFn({});
        if (autoHedge) await autoHedgeTick({});
        try {
          const r = await autoBuyTick({});
          if (alive) setAutoBuyStatus(r.fired ? `FILLED ${r.side} @ ${r.askCents}¢` : r.reason);
          if (r.fired) toast.success(`Auto-buy ${r.side} @ ${r.askCents}¢ × ${r.contracts}`);
        } catch { /* auto-buy is best effort */ }
        await settleFn({});
        if (alive) {
          qc.invalidateQueries({ queryKey: ["paper-kalshi-positions"] });
          qc.invalidateQueries({ queryKey: ["paper-kalshi-events"] });
          qc.invalidateQueries({ queryKey: ["paper-kalshi-equity"] });
        }
      } catch { /* best effort */ }
    };
    void run();
    const t = setInterval(run, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [flipFn, settleFn, autoHedgeTick, autoBuyTick, autoHedge, qc]);


  const w = win.data;
  // Same live composite feed the trendline chart uses — ticks at ~60fps.
  const liveFeed = useLiveCompositeSpot();
  const liveSpot = liveFeed.spot;
  const displaySpot = liveSpot ?? w?.spot ?? null;
  const displayCushion = displaySpot != null && w?.strike != null
    ? displaySpot - w.strike
    : w?.cushionUsd ?? null;
  const secondsLeft = useMemo(() => {
    if (!w?.closeTime) return null;
    return Math.max(0, Math.round((Date.parse(w.closeTime) - Date.now()) / 1000));
  }, [w?.closeTime, tick]);

  const refreshAll = () => {
    void win.refetch();
    void positions.refetch();
    void events.refetch();
  };

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      const r = (await fn()) as { ok?: boolean; error?: string; evaluation?: { message?: string } };
      if (r?.ok === false) toast.error(r.error ?? "failed");
      else if (r?.evaluation?.message) toast.message(r.evaluation.message);
      else toast.success(`${label} done`);
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const n = Math.max(1, Math.min(1000, Number(contracts) || 1));
  const live = (positions.data ?? []).filter((p) => p.status === "open" || p.status === "hedged");
  const done = (positions.data ?? []).filter((p) => p.status === "closed" || p.status === "settled");
  const totalPnl = (positions.data ?? []).reduce((s, p) => s + (p.pnl_cents ?? 0), 0);

  return (
    <section className="border border-border rounded-lg p-4 space-y-4 font-mono">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[color:var(--color-primary)]" />
          <h2 className="text-sm font-bold uppercase tracking-widest">
            // Paper trade — Kalshi BTC 15m
          </h2>
        </div>
        <button
          onClick={refreshAll}
          className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      {/* ---------------- live window strip ---------------- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <Stat label="Ticker" value={w?.ticker ?? "—"} mono />
        <Stat label="Strike" value={w?.strike != null ? `$${w.strike.toLocaleString()}` : "—"} />
        <Stat
          label={liveSpot != null ? "Spot (live)" : w?.spotSource === "own_composite" ? "Spot (our feed)" : "Spot"}
          value={displaySpot != null
            ? `$${displaySpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—"}
        />
        <Stat
          label="Cushion"
          value={displayCushion != null ? `${displayCushion >= 0 ? "+" : ""}$${displayCushion.toFixed(0)}` : "—"}
          tone={displayCushion == null ? undefined : Math.abs(displayCushion) >= 40 ? "good" : "warn"}
        />
        <Stat label="Time left" value={clock(secondsLeft)} tone={secondsLeft != null && secondsLeft < 300 ? "warn" : undefined} />
      </div>

      <OpsPaperPnlChart autoBuyStatus={autoBuyStatus} />

      {w && !w.ok && (
        <div className="text-xs text-red-400">No live window: {w.error ?? "unavailable"}</div>
      )}

      {/* ---------------- UP / DOWN books ---------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SideCard
          label="UP (YES — closes above strike)"
          icon={<TrendingUp className="h-4 w-4" />}
          bid={w?.up.bidCents ?? null}
          ask={w?.up.askCents ?? null}
          highlighted={w?.spotSide === "YES"}
          disabled={!w?.ok || busy != null}
          onBuy={() => act("Buy UP", () => enterFn({ data: { side: "YES", contracts: n, reason: "manual_paper" } }))}
        />
        <SideCard
          label="DOWN (NO — closes below strike)"
          icon={<TrendingDown className="h-4 w-4" />}
          bid={w?.down.bidCents ?? null}
          ask={w?.down.askCents ?? null}
          highlighted={w?.spotSide === "NO"}
          disabled={!w?.ok || busy != null}
          onBuy={() => act("Buy DOWN", () => enterFn({ data: { side: "NO", contracts: n, reason: "manual_paper" } }))}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Contracts</span>
          <input
            value={contracts}
            onChange={(e) => setContracts(e.target.value)}
            inputMode="numeric"
            className="w-24 bg-background border border-border rounded px-2 py-1"
          />
        </label>
        <div className="text-muted-foreground">
          Model <b className="text-foreground">{w?.model.side ?? "—"}</b>
          {w?.model.confidence != null && ` ${(w.model.confidence * 100).toFixed(0)}%`}
          {"  ·  "}Study <b className="text-foreground">{w?.study.side ?? "—"}</b>
          {w?.study.confidence != null && ` ${(w.study.confidence * 100).toFixed(0)}%`}
          {"  ·  "}Verdict <b className="text-foreground">{w?.verdict ?? "—"}</b>
        </div>
      </div>

      {/* ---------------- auto-hedge switch ---------------- */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={autoHedge}
          onChange={(e) => setAutoHedge(e.target.checked)}
          className="accent-[color:var(--color-primary)]"
        />
        <span className="uppercase tracking-widest">Auto-hedge</span>
        <span className="text-muted-foreground">
          every 20s, takes the opposite leg the instant the pair prices ≤96¢ (blocked at ≥70¢ dominance, none inside T−5m)
        </span>
      </label>

      {/* ---------------- tabs ---------------- */}
      <div className="flex gap-1 border-b border-border">
        {([
          ["holdings", `Holdings (${live.length})`],
          ["activity", `Activity (${(events.data ?? []).length})`],
          ["transactions", `Transactions (${done.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-3 py-1.5 text-[10px] uppercase tracking-widest border-b-2 -mb-px",
              tab === key
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <span className={cn("ml-auto self-center text-xs font-bold", totalPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
          Paper P/L {money(totalPnl)}
        </span>
      </div>

      {/* ---------------- holdings ---------------- */}
      {tab === "holdings" && (
        <div className="space-y-2">
          {live.length === 0 && <p className="text-xs text-muted-foreground">No open paper positions.</p>}
          {live.map((p) => (
            <LivePositionRow
              key={p.id}
              p={p}
              busy={busy != null}
              onHedge={() => act("Hedge", () => hedgeFn({ data: { id: p.id, execute: true } }))}
              onCheckHedge={() => act("Hedge check", () => hedgeFn({ data: { id: p.id, execute: false } }))}
              onToggleAuto={() =>
                act("Auto-hedge", () => setAutoHedgeFn({ data: { id: p.id, enabled: !p.auto_hedge } }))
              }
              onExit={(reason) => act("Exit", () => exitFn({ data: { id: p.id, reason } }))}
            />
          ))}
        </div>
      )}

      {/* ---------------- activity ---------------- */}
      {tab === "activity" && (
        <div className="max-h-72 overflow-auto">
          {(events.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          )}
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground uppercase tracking-widest">
              <tr className="text-left">
                <th className="py-1">Time</th>
                <th>Action</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Left</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(events.data ?? []).map((e) => (
                <tr key={e.id} className="border-t border-border/50 align-top">
                  <td className="py-1 whitespace-nowrap">{new Date(e.created_at).toISOString().slice(11, 19)}Z</td>
                  <td><EventBadge kind={e.kind} auto={e.auto} /></td>
                  <td>{e.side ? (e.side === "YES" ? "UP" : "DOWN") : "—"}</td>
                  <td>{e.contracts ?? "—"}</td>
                  <td>{e.price_cents != null ? `${e.price_cents}¢` : "—"}</td>
                  <td>{e.seconds_left != null ? clock(e.seconds_left) : "—"}</td>
                  <td className="text-muted-foreground max-w-[22rem] truncate">{e.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- transactions ---------------- */}
      {tab === "transactions" && (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground uppercase tracking-widest">
              <tr className="text-left">
                <th className="py-1">Window</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Hedge</th>
                <th>Exit</th>
                <th>Flip</th>
                <th>Result</th>
                <th className="text-right">P/L</th>
              </tr>
            </thead>
            <tbody>
              {done.length === 0 && (
                <tr><td colSpan={9} className="py-2 text-muted-foreground">No closed paper trades yet.</td></tr>
              )}
              {done.map((p) => (
                <tr key={p.id} className="border-t border-border/50">
                  <td className="py-1">{new Date(p.close_time).toISOString().slice(11, 16)}Z</td>
                  <td>{p.entry_side === "YES" ? "UP" : "DOWN"}</td>
                  <td>{p.entry_contracts}</td>
                  <td>{p.entry_price_cents}¢</td>
                  <td>{p.hedge_price_cents != null ? `${p.hedge_side === "YES" ? "UP" : "DOWN"} ${p.hedge_price_cents}¢` : "—"}</td>
                  <td>{p.exit_price_cents != null ? `${p.exit_price_cents}¢` : "—"}</td>
                  <td className={p.crossed_strike ? "text-amber-400" : "text-muted-foreground"}>
                    {p.crossed_strike ? "YES" : "—"}
                  </td>
                  <td>{p.outcome ? (p.outcome === "YES" ? "UP" : "DOWN") : p.status}</td>
                  <td className={cn("text-right", (p.pnl_cents ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {money(p.pnl_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}


      <p className="text-[10px] text-muted-foreground">
        Simulated fills at the live Kalshi bid/ask. Hedge legs run through the two-sided engine
        (matched pairs ≤96¢, blocked ≥70¢ dominance, no new legs inside T−5m). Flip = spot has
        crossed the strike against your side — exit, or exit and buy the cheap other side.
      </p>
    </section>
  );
}

function Stat({ label, value, tone, mono }: { label: string; value: string; tone?: "good" | "warn"; mono?: boolean }) {
  return (
    <div className="border border-border/60 rounded px-2 py-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm font-bold truncate",
          mono && "text-[11px]",
          tone === "good" && "text-emerald-400",
          tone === "warn" && "text-amber-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SideCard({
  label, icon, bid, ask, highlighted, disabled, onBuy,
}: {
  label: string;
  icon: React.ReactNode;
  bid: number | null;
  ask: number | null;
  highlighted?: boolean;
  disabled?: boolean;
  onBuy: () => void;
}) {
  return (
    <div className={cn("border rounded-lg p-3 space-y-2", highlighted ? "border-[color:var(--color-primary)]" : "border-border")}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon} {label}
      </div>
      <div className="flex items-baseline gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Buy (ask)</div>
          <div className="text-2xl font-bold">{ask != null ? `${ask}¢` : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sell (bid)</div>
          <div className="text-lg">{bid != null ? `${bid}¢` : "—"}</div>
        </div>
      </div>
      <button
        onClick={onBuy}
        disabled={disabled || ask == null}
        className="w-full text-xs uppercase tracking-widest border border-border rounded py-1 hover:bg-muted disabled:opacity-40"
      >
        Paper buy
      </button>
    </div>
  );
}

const EVENT_TONE: Record<string, string> = {
  entry: "text-sky-400",
  hedge: "text-violet-400",
  exit: "text-orange-400",
  flip: "text-amber-400",
  settle: "text-emerald-400",
  skip: "text-muted-foreground",
};

function EventBadge({ kind, auto }: { kind: PaperKalshiEvent["kind"]; auto: boolean }) {
  return (
    <span className={cn("uppercase tracking-widest font-bold", EVENT_TONE[kind] ?? "text-foreground")}>
      {kind}
      {auto && <span className="ml-1 text-[9px] text-muted-foreground">auto</span>}
    </span>
  );
}

function LivePositionRow({
  p, busy, onHedge, onCheckHedge, onToggleAuto, onExit,
}: {
  p: PaperKalshiPosition;
  busy: boolean;
  onHedge: () => void;
  onCheckHedge: () => void;
  onToggleAuto: () => void;
  onExit: (reason: string) => void;
}) {
  return (
    <div
      className={cn(
        "border rounded p-2 flex flex-wrap items-center gap-3 text-xs",
        p.crossed_strike ? "border-amber-500/70" : "border-border",
      )}
    >
      <span className="font-bold">{p.entry_side === "YES" ? "UP" : "DOWN"}</span>
      <span>{p.entry_contracts} @ {p.entry_price_cents}¢</span>
      {p.hedge_side && <span className="text-muted-foreground">hedge {p.hedge_side === "YES" ? "UP" : "DOWN"} {p.hedge_contracts} @ {p.hedge_price_cents}¢</span>}
      <span className="text-muted-foreground">{new Date(p.close_time).toISOString().slice(11, 16)}Z</span>
      {p.crossed_strike && <span className="text-amber-400 font-bold">FLIP — spot crossed strike</span>}
      <div className="ml-auto flex gap-2">
        <button onClick={onToggleAuto} disabled={busy} className={cn("border rounded px-2 py-1 disabled:opacity-40", p.auto_hedge ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]" : "border-border text-muted-foreground")}>
          Auto {p.auto_hedge ? "on" : "off"}
        </button>
        <button onClick={onCheckHedge} disabled={busy} className="border border-border rounded px-2 py-1 hover:bg-muted disabled:opacity-40">
          Check hedge
        </button>
        <button onClick={onHedge} disabled={busy} className="border border-border rounded px-2 py-1 hover:bg-muted disabled:opacity-40 flex items-center gap-1">
          <Shield className="h-3 w-3" /> Hedge
        </button>
        <button
          onClick={() => onExit(p.crossed_strike ? "flip_exit" : "manual_exit")}
          disabled={busy}
          className="border border-border rounded px-2 py-1 hover:bg-muted disabled:opacity-40 flex items-center gap-1"
        >
          <LogOut className="h-3 w-3" /> Exit
        </button>
      </div>
    </div>
  );
}
