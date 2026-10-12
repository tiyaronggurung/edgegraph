import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useLiveCompositeSpot } from "@/hooks/useLiveCompositeSpot";
import { useStrikeOdds } from "@/hooks/useStrikeOdds";
import { getBtcEssentialSnapshot } from "@/lib/btcEssentialSnapshot.functions";
import { getBtcFlowLeanHistory } from "@/lib/btcFlowLeanHistory.functions";
import { getBtcMarkets } from "@/lib/cryptoBtc.functions";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/hooks/usePlan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/paper-desk")({
  head: () => ({
    meta: [
      { title: "Paper Desk — EdgeGraph AI" },
      { name: "description", content: "Two-sided Kalshi paper-trading bot: P&L, positions and activity. Simulated fills only." },
      { property: "og:title", content: "Paper Desk — EdgeGraph AI" },
      { property: "og:description", content: "Two-sided Kalshi paper-trading bot dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaperDesk,
});

const db = supabase as any;
const REFRESH = 5_000;
const usd = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "-"}${usd(Math.abs(v))}`;
const compact = (v: number) => `$${Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
const ago = (ts: string | null | undefined) => {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const cents = (p: number | null) => (p == null ? "—" : `${Math.round(Number(p) * 100)}¢`);
const RANGES = [
  { k: "1D", s: 86400, l: "Past day" },
  { k: "1W", s: 604800, l: "Past week" },
  { k: "1M", s: 2592000, l: "Past month" },
  { k: "ALL", s: 0, l: "All-Time" },
] as const;

function useRows<T>(key: string, fn: () => Promise<{ data: T | null; error: any }>) {
  return useQuery({
    queryKey: ["paper-desk", key],
    queryFn: async () => {
      const { data, error } = await fn();
      if (error) throw error;
      return data as T;
    },
    refetchInterval: REFRESH,
  });
}

function PaperDesk() {
  const { isAdmin } = usePlan();
  const qc = useQueryClient();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[3]);
  const [tab, setTab] = useState<"active" | "closed" | "activity">("active");
  const [limit, setLimit] = useState(50);

  const summary = useRows<any>("summary", () => db.from("pb_v_summary").select("*").maybeSingle());
  const idx = useRows<any[]>("idx", () => db.from("pb_index_prices").select("*"));
  const active = useRows<any[]>("active", () => db.from("pb_v_active_positions").select("*"));
  const closed = useRows<any[]>("closed", () => db.from("pb_v_closed_positions").select("*").limit(500));
  const activity = useRows<any[]>("activity", () => db.from("pb_v_activity").select("*").limit(500));

  const s = summary.data;
  const live = s?.last_tick_at && Date.now() - Date.parse(s.last_tick_at) < 30_000;

  // Live feeds — the exact same data path as the crypto page: 4-exchange
  // composite spot, 1s window clock, Kalshi strike, window volume and the
  // shared strike-odds engine. Nothing here waits on logged DB rows.
  const liveSpot = useLiveCompositeSpot();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const winStart = Math.floor(nowMs / 900_000) * 900_000;
  const liveSecsLeft = Math.max(0, Math.round((winStart + 900_000 - nowMs) / 1000));

  const essentialFn = useServerFn(getBtcEssentialSnapshot);
  const marketsFn = useServerFn(getBtcMarkets);
  const histFn = useServerFn(getBtcFlowLeanHistory);
  const { data: essential } = useQuery({
    queryKey: ["btc-essential-snapshot", winStart],
    queryFn: () => essentialFn(),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (a) => Math.min(200 * 2 ** a, 1_500),
    placeholderData: keepPreviousData,
  });
  const { data: markets } = useQuery({
    queryKey: ["btc-markets"],
    queryFn: () => marketsFn(),
    refetchInterval: 2_000,
    staleTime: 1_000,
    placeholderData: keepPreviousData,
  });
  const { data: hist } = useQuery({
    queryKey: ["btc-flow-lean-history"],
    queryFn: () => histFn(),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
    retry: 2,
  });

  // Kalshi's own live market (current 15m window) — yes bid/ask straight
  // from the same feed the crypto page reads.
  const kalshiMarket = markets?.markets
    ?.filter((m: any) => m.secondsToClose > 0)
    .sort((a: any, b: any) => a.secondsToClose - b.secondsToClose)[0] ?? null;

  // Strike: same priority chain as the crypto page, held only within its window.
  const lastStrikeRef = useRef<{ winStart: number; strike: number } | null>(null);
  const kalshiStrike = essential?.strike;
  if (kalshiStrike?.ok && kalshiStrike.strike != null) {
    lastStrikeRef.current = { winStart, strike: kalshiStrike.strike };
  }
  const held = lastStrikeRef.current;
  const strike =
    kalshiStrike?.strike ?? kalshiMarket?.strike ?? (held != null && held.winStart === winStart ? held.strike : null);

  const spot = liveSpot.spot ?? null;
  const win = essential?.volume;
  const winLeg = win?.windowStart === winStart ? (win?.window ?? null) : null;
  const imbM3 = win?.m3?.imbalance ?? null;
  const currentRow = hist?.rows?.find((r: any) => r.result == null) ?? hist?.rows?.[0] ?? null;

  // Our odds — identical engine and inputs to the crypto page card.
  const oddsSpot = liveSpot.targetSpot ?? spot;
  const odds = useStrikeOdds(oddsSpot, strike ?? null, liveSecsLeft, {
    m1: hist?.live?.m1 ?? null,
    m15: hist?.live?.m15 ?? null,
    avgBuyPrice: currentRow?.avgBuyPrice ?? null,
    avgSellPrice: currentRow?.avgSellPrice ?? null,
    flowImbalance: imbM3,
    stack: hist?.live?.stack ?? null,
  });
  const pUp = odds.pUp;
  const gap = spot != null && strike != null ? spot - strike : null;
  // Real-money P&L only — Paper Desk's live Kalshi fills (source "paper_desk_live"),
  // settled results from crypto_trades. Paper equity is no longer charted.
  const realTrades = useRows<any[]>(
    `real-${range.s}`,
    () => {
      let q = db
        .from("crypto_trades")
        .select("id, created_at, status, pnl_usd, raw")
        .eq("status", "settled")
        .filter("inputs_snapshot->>source", "eq", "paper_desk_live");
      if (range.s > 0) q = q.gte("created_at", new Date(Date.now() - range.s * 1000).toISOString());
      return q.order("created_at", { ascending: true }).limit(2000) as never;
    },
  );
  const pts = (realTrades.data ?? [])
    .map((r) => ({ t: r.raw?.settle?.at ?? r.created_at, pnl: Number(r.pnl_usd ?? 0) }))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  let realAcc = 0;
  const cum = pts.map((p) => { realAcc += p.pnl; return { t: p.t, pnl: realAcc }; });
  const rangePnl = realAcc;
  const up = rangePnl >= 0;
  const winRate = s && s.settled_markets > 0 ? `${((s.winning_markets / s.settled_markets) * 100).toFixed(0)}%` : "—";

  const control = async (running: boolean) => {
    const { error } = await db.rpc("paper_bot_update_settings", { p_running: running, p_series: null, p_strategy: null, p_taker_fee_rate: null });
    if (error) return toast.error(error.message);
    toast.success(running ? "Paper bot started" : "Paper bot paused");
    qc.invalidateQueries({ queryKey: ["paper-desk"] });
  };
  const setLive = async (enabled: boolean) => {
    if (enabled && !confirm("Turn on REAL MONEY trading on Kalshi? Max $10 open at once, one buy per window, daily loss stop stays on.")) return;
    const { error } = await db.rpc("paper_bot_set_live", { p_enabled: enabled });
    if (error) return toast.error(error.message);
    toast.success(enabled ? "LIVE trading on — real money, $10 cap" : "Live trading off — back to paper");
    qc.invalidateQueries({ queryKey: ["paper-desk"] });
  };
  const reset = async () => {
    const v = prompt("New paper budget ($)", String(s?.start_cash ?? 3000));
    if (!v) return;
    const { error } = await db.rpc("paper_bot_reset", { new_budget: Number(v) });
    if (error) return toast.error(error.message);
    toast.success("Paper run reset");
    qc.invalidateQueries({ queryKey: ["paper-desk"] });
  };

  const rows = tab === "active" ? active.data ?? [] : tab === "closed" ? closed.data ?? [] : activity.data ?? [];

  return (
    <div className="space-y-4 font-mono">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold tracking-widest neon-text">PAPER DESK</h1>
          <span className="text-[10px] px-2 py-0.5 rounded border border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)] uppercase tracking-widest">Paper trading</span>
          {s?.live_enabled && (
            <span className="text-[10px] px-2 py-0.5 rounded border border-[color:var(--color-destructive)] text-[color:var(--color-destructive)] uppercase tracking-widest animate-pulse">LIVE · real money · $10 cap</span>
          )}
          {(idx.data ?? []).map((r) => (
            <span key={r.coin} className="text-[11px] px-2 py-0.5 rounded bg-card border border-border">
              {String(r.coin).toUpperCase()} {usd(Number(r.price))} · {ago(r.ts)}
            </span>
          ))}
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
              <button
                onClick={() => setLive(!s.live_enabled)}
                className={cn(
                  "px-2 py-1 border rounded uppercase tracking-widest text-[10px]",
                  s.live_enabled
                    ? "border-[color:var(--color-destructive)] text-[color:var(--color-destructive)] hover:bg-card"
                    : "border-border hover:bg-card",
                )}
              >
                {s.live_enabled ? "Stop live" : "Go live $10"}
              </button>
              <button onClick={reset} className="px-2 py-1 border border-border rounded uppercase tracking-widest text-[10px] hover:bg-card">Reset</button>
            </>
          )}
        </div>
      </header>
      {s?.last_error && <p className="text-[11px] text-[color:var(--color-destructive)]">⚠ {s.last_error}</p>}

      {/* Live data strip — identical feeds to the crypto page: our odds,
          Kalshi prices, composite price vs strike, window volume, clock */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Our odds</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-xl font-bold text-[color:var(--color-primary)]">UP {cents(pUp)}</span>
            <span className="text-xl font-bold text-[color:var(--color-destructive)]">DOWN {cents(pUp != null ? 1 - pUp : null)}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">live · same engine as crypto page</div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Kalshi market</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-xl font-bold text-[color:var(--color-primary)]">YES {kalshiMarket ? `${Math.round(Number(kalshiMarket.yesAsk) * 100)}¢` : "—"}</span>
            <span className="text-xl font-bold text-[color:var(--color-destructive)]">NO {kalshiMarket?.yesBid != null ? `${Math.round((1 - Number(kalshiMarket.yesBid)) * 100)}¢` : "—"}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {kalshiMarket ? `bid ${Math.round(Number(kalshiMarket.yesBid) * 100)}¢ / ask ${Math.round(Number(kalshiMarket.yesAsk) * 100)}¢ · 2s poll` : "waiting for Kalshi…"}
          </div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Composite price vs strike</div>
          <div className="mt-1 text-xl font-bold">{spot != null ? usd(spot, 0) : "—"}</div>
          <div className={cn("text-[11px]", (gap ?? 0) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
            strike {strike != null ? usd(strike, 0) : "—"} ({gap != null ? `${gap >= 0 ? "+" : ""}${gap.toFixed(0)}` : "—"})
          </div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Window volume (composite)</div>
          <div className="mt-1 text-sm font-bold">
            in {winLeg ? winLeg.buy.toFixed(2) : "—"} / out {winLeg ? winLeg.sell.toFixed(2) : "—"} BTC
          </div>
          <div className={cn("text-[11px]", (winLeg?.imbalance ?? 0) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
            imbalance {winLeg ? `${(winLeg.imbalance * 100).toFixed(0)}%` : "—"} · 3m lean {imbM3 != null ? `${(imbM3 * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Time left in window</div>
          <div className="mt-1 text-xl font-bold">{Math.floor(liveSecsLeft / 60)}m {liveSecsLeft % 60}s</div>
          <div className="text-[10px] text-muted-foreground">live 1s clock</div>
        </div>
      </section>


      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[color:var(--color-primary)] to-[color:var(--color-destructive)]" />
            <div>
              <div className="font-bold">Two-sided bot</div>
              <div className="text-[11px] text-muted-foreground">Kalshi · simulated fills, no real orders</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat l="Positions value" v={usd(s?.positions_value)} />
            <Stat l="Biggest win" v={s && Number(s.biggest_win) !== 0 ? usd(s.biggest_win) : "–"} />
            <Stat l="Markets traded" v={String(s?.markets_traded ?? "—")} />
            <Stat l="Total volume" v={s ? compact(Number(s.volume)) : "—"} />
            <Stat l="Cash" v={usd(s?.cash)} />
            <Stat l="Win rate" v={winRate} />
            <Stat l="Fees paid" v={usd(s?.fees)} />
            <Stat l="Biggest loss" v={s && Number(s.biggest_loss) !== 0 ? usd(s.biggest_loss) : "–"} />
          </div>
        </section>

        <section className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Real-money Profit/Loss</div>
              <div className={cn("text-3xl font-bold", up ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>{signed(rangePnl)}</div>
              <div className="text-[11px] text-muted-foreground">{range.l} · settled Kalshi fills only</div>
            </div>
            <div className="flex border border-border rounded overflow-hidden text-[10px]">
              {RANGES.map((r) => (
                <button key={r.k} onClick={() => setRange(r)} className={cn("px-2 py-1", range.k === r.k ? "bg-card text-[color:var(--color-primary)]" : "text-muted-foreground")}>{r.k}</button>
              ))}
            </div>
          </div>
          <div className="h-56">
            {cum.length < 2 ? (
              <div className="h-full grid place-items-center text-xs text-muted-foreground">The chart fills in as real-money trades settle.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cum} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pbFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={up ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={up ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} minTickGap={80} dy={6}
                    tickFormatter={(t: string) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
                  <YAxis orientation="right" axisLine={false} tickLine={false} tickCount={4} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} width={52} tickFormatter={(v: number) => usd(v, 0)} domain={["auto", "auto"]} />
                  <Tooltip cursor={{ stroke: "var(--color-muted-foreground)", strokeOpacity: 0.3, strokeDasharray: "3 3" }}
                    contentStyle={{ fontSize: 11, background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)" }}
                    formatter={(v: number) => [signed(v), "Real P&L"]} labelFormatter={(t: string) => new Date(t).toLocaleString()} />
                  <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="pnl" stroke={up ? "var(--color-primary)" : "var(--color-destructive)"} strokeWidth={2.5} fill="url(#pbFill)" isAnimationActive={false}
                    dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: up ? "var(--color-primary)" : "var(--color-destructive)" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex gap-2 text-[11px] uppercase tracking-widest">
          {(["active", "closed", "activity"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setLimit(50); }}
              className={cn("px-3 py-1 rounded border", tab === t ? "border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)]" : "border-border text-muted-foreground")}>
              {t === "active" ? "Positions · Active" : t === "closed" ? "Positions · Closed" : "Activity"}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {rows.length === 0 && <tr><td className="py-6 text-center text-muted-foreground">Nothing yet.</td></tr>}
              {rows.slice(0, limit).map((r: any, i: number) =>
                tab === "activity" ? <ActivityRow key={i} r={r} /> : tab === "active" ? <ActiveRow key={r.ticker} r={r} /> : <ClosedRow key={r.ticker} r={r} />,
              )}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button onClick={() => setLimit((l) => l + 50)} className="text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground">Show more</button>
        )}
      </section>

      <p className="text-[10px] text-muted-foreground">
        Simulated paper trading on Kalshi's public data. No real orders. Total P&L = cash + open positions at the current bid − starting budget, fees included.
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

function Holdings({ r }: { r: any }) {
  return (
    <div className="space-x-2">
      {Number(r.yes_ct) > 0 && <span className="text-[color:var(--color-primary)]">YES {Number(r.yes_ct)} @ {cents(r.yes_avg)}</span>}
      {Number(r.no_ct) > 0 && <span className="text-[color:var(--color-destructive)]">NO {Number(r.no_ct)} @ {cents(r.no_avg)}</span>}
    </div>
  );
}

function Pnl({ v, cost }: { v: number; cost?: number }) {
  return (
    <span className={v >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]"}>
      {signed(v)}{cost ? ` (${((v / cost) * 100).toFixed(1)}%)` : ""}
    </span>
  );
}

function ActiveRow({ r }: { r: any }) {
  const left = Math.max(0, Math.round((Date.parse(r.close_ts) - Date.now()) / 1000));
  const gap = r.gap == null ? null : Number(r.gap);
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3">
        <div>{r.title}</div>
        <div className="text-[10px] text-muted-foreground">{r.ticker} · closes in {Math.floor(left / 60)}m {left % 60}s</div>
        {r.index_price != null && r.strike != null && (
          <div className={cn("text-[10px]", (gap ?? 0) >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
            {String(r.coin).toUpperCase()} {usd(Number(r.index_price), 0)} vs target {usd(Number(r.strike), 0)} ({gap! >= 0 ? "+" : "-"}{usd(Math.abs(gap!), 0)})
          </div>
        )}
      </td>
      <td className="py-2 pr-3"><Holdings r={r} /></td>
      <td className="py-2 pr-3">{usd(Number(r.cost))}</td>
      <td className="py-2 pr-3">{usd(Number(r.value))}</td>
      <td className="py-2"><Pnl v={Number(r.pnl)} cost={Number(r.cost)} /></td>
    </tr>
  );
}

function ClosedRow({ r }: { r: any }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3"><div>{r.title}</div><div className="text-[10px] text-muted-foreground">{r.ticker} · {ago(r.settled_at)}</div></td>
      <td className="py-2 pr-3">{String(r.result).toUpperCase()} won</td>
      <td className="py-2 pr-3"><Holdings r={r} /></td>
      <td className="py-2 pr-3">{usd(Number(r.cost))}</td>
      <td className="py-2 pr-3">{usd(Number(r.payout))}</td>
      <td className="py-2"><Pnl v={Number(r.pnl)} /></td>
    </tr>
  );
}

function ActivityRow({ r }: { r: any }) {
  const yes = r.side === "yes";
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3">
        <span className={cn("px-1.5 py-0.5 rounded text-[10px] border", yes ? "border-[color:var(--color-primary)]/50 text-[color:var(--color-primary)]" : "border-[color:var(--color-destructive)]/50 text-[color:var(--color-destructive)]")}>
          {r.type === "buy" ? `BUY ${String(r.side).toUpperCase()}` : `SETTLED · ${String(r.side).toUpperCase()}`}
        </span>
        {r.reason && <div className="text-[10px] text-muted-foreground mt-1">{r.reason}</div>}
      </td>
      <td className="py-2 pr-3">{r.title}</td>
      <td className="py-2 pr-3">{Number(r.contracts)}</td>
      <td className="py-2 pr-3">{cents(r.price)}</td>
      <td className="py-2 pr-3">{usd(Number(r.amount))}{r.pnl != null && <div><Pnl v={Number(r.pnl)} /></div>}</td>
      <td className="py-2 text-muted-foreground">{ago(r.ts)}</td>
    </tr>
  );
}
