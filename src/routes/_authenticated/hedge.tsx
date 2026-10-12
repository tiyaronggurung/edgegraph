import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useBinanceBtcTicks } from "@/hooks/useBinanceBtcTicks";
import { computeUpProbability, effectiveVol, momentumTilt } from "@/lib/ourOdds";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/hooks/usePlan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/hedge")({
  head: () => ({
    meta: [
      { title: "Hedge Desk — EdgeGraph AI" },
      { name: "description", content: "Paper hedge bot driven by our own BTC odds, volume and composite price. Simulated fills only." },
      { property: "og:title", content: "Hedge Desk — EdgeGraph AI" },
      { property: "og:description", content: "Paper hedge bot on our own BTC odds and volume." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HedgeDesk,
});

const db = supabase as any;
const REFRESH = 3_000;
const usd = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "-"}${usd(Math.abs(v))}`;
const cents = (p: number | null | undefined) => (p == null ? "—" : `${(Number(p) * 100).toFixed(0)}¢`);
const ago = (ts: string | null | undefined) => {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

function useRows<T>(key: string, fn: () => Promise<{ data: T | null; error: any }>) {
  return useQuery({
    queryKey: ["hedge-desk", key],
    queryFn: async () => {
      const { data, error } = await fn();
      if (error) throw error;
      return data as T;
    },
    refetchInterval: REFRESH,
  });
}

function HedgeDesk() {
  const { isAdmin } = usePlan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"windows" | "activity">("windows");

  const settings = useRows<any>("settings", () => db.from("hd_settings").select("*").eq("id", 1).maybeSingle());
  const odds = useRows<any>("odds", () =>
    db.from("btc_agreement_log").select("bucket_sec, odds_p_up, spot, strike, seconds_to_close")
      .not("odds_p_up", "is", null).order("bucket_sec", { ascending: false }).limit(1).maybeSingle());
  const windowStartIso = new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString();
  const flow = useRows<any>(`flow-${windowStartIso}`, () =>
    db.from("btc_composite_flow_log").select("composite_in_btc, composite_out_btc, composite_imbalance, recorded_at")
      .eq("window_start", windowStartIso).order("recorded_at", { ascending: false }).limit(1).maybeSingle());
  const current = useRows<any>(`win-${windowStartIso}`, () =>
    db.from("hd_windows").select("*").eq("window_start", windowStartIso).maybeSingle());
  const closed = useRows<any[]>("closed", () =>
    db.from("hd_windows").select("*").eq("settled", true).order("window_start", { ascending: false }).limit(100));
  const activity = useRows<any[]>("activity", () =>
    db.from("hd_fills").select("*").order("id", { ascending: false }).limit(100));
  const curve = useRows<any[]>("equity", () => db.rpc("hd_equity_range", { range_seconds: 0 }));

  // Live feeds: composite spot (4-exchange WS) + 1s window clock.
  const liveSpot = useLiveCompositeSpot();
  const { ticks } = useBinanceBtcTicks();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const s = settings.data;
  const o = odds.data;
  const liveSecsLeft = 900 - Math.floor((nowMs % 900_000) / 1000);
  const strike = o?.strike != null ? Number(o.strike) : null;
  const spot = liveSpot.spot ?? (o?.spot != null ? Number(o.spot) : null);
  // Live pUp from the same math as the crypto page; falls back to the last
  // logged odds row when vol/spot aren't available yet.
  const livePUp = (() => {
    if (spot == null || strike == null) return null;
    const tape = ticks.map((t) => ({ t: t.t, p: t.p }));
    const sigma = effectiveVol(tape, [], liveSecsLeft) ?? 0.5;
    const base = computeUpProbability({ spot, strike, secondsToClose: liveSecsLeft, sigmaAnnualized: sigma });
    if (base == null) return null;
    const tilt = momentumTilt(tape, 60_000, liveSecsLeft);
    return Math.min(0.995, Math.max(0.005, base + tilt));
  })();
  const pUp = livePUp ?? (o?.odds_p_up != null ? Number(o.odds_p_up) : null);
  const oddsFresh = livePUp != null || (o && Date.now() / 1000 - Number(o.bucket_sec) <= 90);
  const live = s?.last_tick_at && Date.now() - Date.parse(s.last_tick_at) < 30_000;

  const w = current.data;
  const upAvg = w && Number(w.up_ct) > 0 ? Number(w.up_cost) / Number(w.up_ct) : null;
  const dnAvg = w && Number(w.down_ct) > 0 ? Number(w.down_cost) / Number(w.down_ct) : null;
  const pairCost = upAvg != null && dnAvg != null ? upAvg + dnAvg : null;
  const lockedProfit = pairCost != null && w ? Math.min(Number(w.up_ct), Number(w.down_ct)) * (1 - pairCost) : null;

  const pts = (curve.data ?? []).map((p) => ({ t: p.ts, pnl: Number(p.pnl) }));
  const totalPnl = pts.length ? pts[pts.length - 1].pnl : 0;
  const up = totalPnl >= 0;
  const closedRows = closed.data ?? [];
  const lockedWins = closedRows.filter((r) => r.locked);
  const lockedWinRate = lockedWins.length ? `${((lockedWins.filter((r) => Number(r.pnl) > 0).length / lockedWins.length) * 100).toFixed(0)}%` : "—";

  const control = async (running: boolean) => {
    const { error } = await db.rpc("hd_update_settings", { p_running: running });
    if (error) return toast.error(error.message);
    toast.success(running ? "Hedge bot started" : "Hedge bot paused");
    qc.invalidateQueries({ queryKey: ["hedge-desk"] });
  };
  const reset = async () => {
    const v = prompt("New paper budget ($)", String(s?.start_cash ?? 3000));
    if (!v) return;
    const { error } = await db.rpc("hd_reset", { new_budget: Number(v) });
    if (error) return toast.error(error.message);
    toast.success("Hedge desk reset");
    qc.invalidateQueries({ queryKey: ["hedge-desk"] });
  };

  const secsLeft = o?.seconds_to_close != null ? Number(o.seconds_to_close) : null;
  const gap = o?.spot != null && o?.strike != null ? Number(o.spot) - Number(o.strike) : null;

  return (
    <div className="space-y-4 font-mono">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold tracking-widest neon-text">HEDGE DESK</h1>
          <span className="text-[10px] px-2 py-0.5 rounded border border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)] uppercase tracking-widest">Paper · our odds</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", live ? "bg-[color:var(--color-primary)] animate-pulse" : "bg-muted-foreground")} />
            {live ? `live · updated ${ago(s?.last_tick_at)}` : "bot idle"}
          </span>
          {isAdmin && s && (
            <>
              <button onClick={() => control(!s.running)} className="px-2 py-1 border border-border rounded uppercase tracking-widest text-[10px] hover:bg-card">
                {s.running ? "Pause" : "Start"}
              </button>
              <button onClick={reset} className="px-2 py-1 border border-border rounded uppercase tracking-widest text-[10px] hover:bg-card">Reset</button>
            </>
          )}
        </div>
      </header>
      {s?.last_error && <p className="text-[11px] text-[color:var(--color-destructive)]">⚠ {s.last_error}</p>}

      {/* Our data strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Our odds {oddsFresh ? "" : "(stale)"}</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-xl font-bold text-[color:var(--color-primary)]">UP {cents(pUp)}</span>
            <span className="text-xl font-bold text-[color:var(--color-destructive)]">DOWN {cents(pUp != null ? 1 - pUp : null)}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">updated {ago(o ? new Date(Number(o.bucket_sec) * 1000).toISOString() : null)}</div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Composite price vs strike</div>
          <div className="mt-1 text-xl font-bold">{o?.spot != null ? usd(Number(o.spot), 0) : "—"}</div>
          <div className={cn("text-[11px]", (gap ?? 0) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
            strike {o?.strike != null ? usd(Number(o.strike), 0) : "—"} ({gap != null ? `${gap >= 0 ? "+" : ""}${gap.toFixed(0)}` : "—"})
          </div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Window volume (composite)</div>
          <div className="mt-1 text-sm font-bold">
            in {flow.data ? Number(flow.data.composite_in_btc).toFixed(2) : "—"} / out {flow.data ? Number(flow.data.composite_out_btc).toFixed(2) : "—"} BTC
          </div>
          <div className={cn("text-[11px]", Number(flow.data?.composite_imbalance ?? 0) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
            imbalance {flow.data?.composite_imbalance != null ? `${(Number(flow.data.composite_imbalance) * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Time left in window</div>
          <div className="mt-1 text-xl font-bold">{secsLeft != null ? `${Math.floor(secsLeft / 60)}m ${secsLeft % 60}s` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">no new buys in the final {s?.skip_final_seconds ?? 60}s</div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Current window position */}
        <section className="border border-border rounded-lg p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">This window's position</div>
          {w && (Number(w.up_ct) > 0 || Number(w.down_ct) > 0) ? (
            <>
              <div className="space-x-3 text-sm">
                {Number(w.up_ct) > 0 && <span className="text-[color:var(--color-primary)]">UP {Number(w.up_ct)} @ {cents(upAvg)}</span>}
                {Number(w.down_ct) > 0 && <span className="text-[color:var(--color-destructive)]">DOWN {Number(w.down_ct)} @ {cents(dnAvg)}</span>}
              </div>
              {pairCost != null ? (
                <div className="text-[11px]">
                  pair cost <b>{cents(pairCost)}</b> →{" "}
                  <span className="text-[color:var(--color-primary)] font-bold">locked +{cents(lockedProfit)} per pair</span>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">one-sided — waiting for the other side to get cheap (≤ {cents(s?.hedge_max ?? 0.45)})</div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground">
              flat — waiting for a side at ≤ {cents(s?.entry_max ?? 0.45)} on our odds
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <Stat l="Cash" v={usd(s?.cash)} />
            <Stat l="Locked-pair win rate" v={lockedWinRate} />
          </div>
        </section>

        {/* P&L chart */}
        <section className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Profit/Loss</div>
              <div className={cn("text-3xl font-bold", up ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>{signed(totalPnl)}</div>
              <div className="text-[11px] text-muted-foreground">All-Time · paper</div>
            </div>
          </div>
          <div className="h-56">
            {pts.length < 2 ? (
              <div className="h-full grid place-items-center text-xs text-muted-foreground">The chart fills in as the bot runs.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pts} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hdFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={up ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={up ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="currentColor" className="text-border" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={60} stroke="currentColor" className="text-muted-foreground"
                    tickFormatter={(t: string) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
                  <YAxis orientation="right" tickCount={3} tick={{ fontSize: 10 }} width={60} stroke="currentColor" className="text-muted-foreground" tickFormatter={(v: number) => usd(v, 0)} />
                  <Tooltip contentStyle={{ fontSize: 11, background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                    formatter={(v: number) => [signed(v), "P&L"]} labelFormatter={(t: string) => new Date(t).toLocaleString()} />
                  <ReferenceLine y={0} stroke="currentColor" className="text-muted-foreground" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="pnl" stroke={up ? "var(--color-primary)" : "var(--color-destructive)"} strokeWidth={2} fill="url(#hdFill)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      {/* Windows / Activity */}
      <section className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex gap-2 text-[11px] uppercase tracking-widest">
          {(["windows", "activity"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-3 py-1 rounded border", tab === t ? "border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)]" : "border-border text-muted-foreground")}>
              {t === "windows" ? "Settled windows" : "Activity"}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {tab === "windows" ? (
                closedRows.length === 0 ? (
                  <tr><td className="py-6 text-center text-muted-foreground">No settled windows yet.</td></tr>
                ) : (
                  closedRows.map((r) => (
                    <tr key={r.window_start} className="border-t border-border align-top">
                      <td className="py-2 pr-3">{new Date(r.window_start).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-2 pr-3">{r.result} won</td>
                      <td className="py-2 pr-3 space-x-2">
                        {Number(r.up_ct) > 0 && <span className="text-[color:var(--color-primary)]">UP {Number(r.up_ct)} @ {cents(Number(r.up_cost) / Number(r.up_ct))}</span>}
                        {Number(r.down_ct) > 0 && <span className="text-[color:var(--color-destructive)]">DOWN {Number(r.down_ct)} @ {cents(Number(r.down_cost) / Number(r.down_ct))}</span>}
                        {r.locked && <span className="text-[10px] px-1.5 py-0.5 rounded border border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)]">LOCKED</span>}
                      </td>
                      <td className="py-2 pr-3">{usd(Number(r.up_cost) + Number(r.down_cost))}</td>
                      <td className="py-2 pr-3">{usd(Number(r.payout))}</td>
                      <td className={cn("py-2", Number(r.pnl) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>{signed(Number(r.pnl))}</td>
                    </tr>
                  ))
                )
              ) : (activity.data ?? []).length === 0 ? (
                <tr><td className="py-6 text-center text-muted-foreground">Nothing yet.</td></tr>
              ) : (
                (activity.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] border",
                        r.kind === "settle" ? "border-border text-muted-foreground"
                        : r.side === "UP" ? "border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)]"
                        : "border-[color:var(--color-destructive)]/50 text-[color:var(--color-destructive)]")}>
                        {r.kind === "settle" ? `SETTLED · ${r.side}` : `${r.kind === "entry" ? "BUY" : "HEDGE"} ${r.side}`}
                      </span>
                      {r.reason && <div className="text-[10px] text-muted-foreground mt-1">{r.reason}</div>}
                    </td>
                    <td className="py-2 pr-3">{Number(r.contracts)}</td>
                    <td className="py-2 pr-3">{cents(r.price)}</td>
                    <td className="py-2 pr-3">{usd(Number(r.amount))}{r.pnl != null && <div className={Number(r.pnl) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]"}>{signed(Number(r.pnl))}</div>}</td>
                    <td className="py-2 text-muted-foreground">{ago(r.ts)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[10px] text-muted-foreground">
        Paper hedge bot on our own data only: our odds, window volume and composite price from the crypto page. No Kalshi orders, no real money.
        Rule: buy a side when our odds price it ≤ {cents(s?.entry_max ?? 0.45)}, hedge the other side when it drops to ≤ {cents(s?.hedge_max ?? 0.45)} — a pair under $1 locks profit either way.
      </p>
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{l}</div>
      <div className="text-sm font-bold mt-0.5">{v}</div>
    </div>
  );
}
