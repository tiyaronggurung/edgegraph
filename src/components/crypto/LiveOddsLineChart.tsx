// Kalshi-style live UP vs DOWN line chart for the current 15m window.
// Presentation only: samples the odds already computed on the page, saves
// each window's line + strike + result for replay. Never feeds trading,
// model, Study or exit paths.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fetchKalshiSettlement } from "@/lib/kalshiSettle";
import { tickerForWindowClose } from "@/lib/marketIntel/windowMapping";

type Pt = { t: number; up: number };
type Saved = {
  window_start: string;
  strike: number | null;
  close_spot: number | null;
  result: string | null;
  points: [number, number][]; // [secondsFromStart, upCents*10]
};
const db = supabase as any;
const WIN_MS = 900_000;
const SAMPLE_MS = 1_000;
const SAVE_MS = 10_000;
const W = 900;
const H = 220;
const PAD_R = 110;
const PAD_T = 12;
const PAD_B = 24;

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
const usd0 = (v: number | null | undefined) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const encode = (pts: Pt[], ws: number): [number, number][] =>
  pts.map((p) => [Math.round((p.t - ws) / 1000), Math.round(p.up * 1000)]);
const decode = (raw: [number, number][], ws: number): Pt[] =>
  (raw ?? []).map(([s, u]) => ({ t: ws + s * 1000, up: u / 1000 }));

export function LiveOddsLineChart({
  upAsk, winStart, strike, spot,
}: { upAsk: number | null; winStart: number; strike: number | null; spot: number | null }) {
  const qc = useQueryClient();
  const [pts, setPts] = useState<Pt[]>([]);
  const latest = useRef({ upAsk, strike, spot });
  latest.current = { upAsk, strike, spot };
  const ptsRef = useRef<Pt[]>([]);
  ptsRef.current = pts;
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ["live-odds-windows"],
    queryFn: async () => {
      const { data, error } = await db
        .from("live_odds_windows")
        .select("window_start,strike,close_spot,result,points")
        .order("window_start", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as Saved[];
    },
    refetchInterval: 60_000,
  });

  const save = async (ws: number, data: Pt[], final: boolean) => {
    const { strike: k, spot: s } = latest.current;
    if (!data.length) return;
    const iso = new Date(ws).toISOString();
    // Merge with whatever is already saved (other tabs / before a reload) so a
    // fresh page never overwrites a longer recording.
    const { data: existing } = await db
      .from("live_odds_windows").select("points,strike,result").eq("window_start", iso).maybeSingle();
    const merged = new Map<number, number>();
    for (const [sec, u] of (existing?.points ?? []) as [number, number][]) merged.set(sec, u);
    for (const [sec, u] of encode(data, ws)) merged.set(sec, u);
    const row: Record<string, unknown> = {
      window_start: iso,
      updated_at: new Date().toISOString(),
      points: [...merged.entries()].sort((a, b) => a[0] - b[0]),
    };
    if (k != null) row.strike = k;
    if (final && !existing?.result) {
      // Kalshi's official settlement is the source of truth; our own spot can
      // drift a few dollars from their expiration_value near the strike.
      const ticker = tickerForWindowClose(ws + WIN_MS);
      const ks = ticker ? await fetchKalshiSettlement(ticker) : null;
      if (ks?.finalized && ks.result) {
        row.result = ks.result === "yes" ? "UP" : "DOWN";
        row.close_spot = ks.expirationValue ?? s;
      } else if (k != null && s != null) {
        row.close_spot = s;
        row.result = s >= k ? "UP" : "DOWN";
      }
    }
    await db.from("live_odds_windows").upsert(row, { onConflict: "window_start" });
  };

  // Windows that closed while the page was shut: take the settled result
  // from the recorded window outcome so their chip still appears.
  useEffect(() => {
    const pending = (history.data ?? []).filter(
      (h) => !h.result && Date.parse(h.window_start) + WIN_MS < Date.now(),
    );
    if (!pending.length) return;
    void (async () => {
      let changed = false;
      for (const h of pending) {
        const closeMs = Date.parse(h.window_start) + WIN_MS;
        const close = new Date(closeMs).toISOString();
        // Primary: Kalshi's official settlement for this window's ticker.
        const ticker = tickerForWindowClose(closeMs);
        const ks = ticker ? await fetchKalshiSettlement(ticker) : null;
        if (ks?.finalized && ks.result) {
          await db.from("live_odds_windows")
            .update({ result: ks.result === "yes" ? "UP" : "DOWN", close_spot: ks.expirationValue ?? h.close_spot })
            .eq("window_start", h.window_start);
          changed = true;
          continue;
        }
        // Fallback: our recorded model outcome for the same close time.
        const { data } = await db
          .from("btc_model_predictions").select("outcome,strike")
          .eq("close_time", close).not("outcome", "is", null).limit(1).maybeSingle();
        if (!data?.outcome) continue;
        const result = data.outcome === "YES" ? "UP" : "DOWN";
        await db.from("live_odds_windows")
          .update({ result, strike: h.strike ?? data.strike })
          .eq("window_start", h.window_start);
        changed = true;
      }
      if (changed) void qc.invalidateQueries({ queryKey: ["live-odds-windows"] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data]);

  // Rollover: settle the finished window, then start fresh. Load any points
  // already saved for the new window (e.g. page reopened mid-window).
  const prevWin = useRef(winStart);
  useEffect(() => {
    const prev = prevWin.current;
    if (prev !== winStart) {
      const done = ptsRef.current.filter((p) => p.t < prev + WIN_MS);
      void save(prev, done, true).then(() => qc.invalidateQueries({ queryKey: ["live-odds-windows"] }));
      prevWin.current = winStart;
    }
    setPts([]);
    void db
      .from("live_odds_windows")
      .select("points")
      .eq("window_start", new Date(winStart).toISOString())
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.points?.length) setPts((cur) => (cur.length >= data.points.length ? cur : [...decode(data.points, winStart), ...cur]));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart]);

  useEffect(() => {
    const id = setInterval(() => {
      const v = latest.current.upAsk;
      if (v == null || !Number.isFinite(v)) return;
      const t = Date.now();
      if (t < winStart || t >= winStart + WIN_MS) return;
      setPts((p) => [...p, { t, up: v }]);
    }, SAMPLE_MS);
    const sid = setInterval(() => void save(winStart, ptsRef.current, false), SAVE_MS);
    return () => { clearInterval(id); clearInterval(sid); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart]);

  const sel = selected ? history.data?.find((h) => h.window_start === selected) ?? null : null;
  const viewStart = sel ? Date.parse(sel.window_start) : winStart;
  const viewPts = sel ? decode(sel.points, viewStart) : pts;
  const viewStrike = sel ? sel.strike : strike;

  const plotW = W - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (t: number) => ((t - viewStart) / WIN_MS) * plotW;
  const y = (p: number) => PAD_T + (1 - p) * plotH;
  const path = (f: (p: Pt) => number) =>
    viewPts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(f(p)).toFixed(1)}`).join("");

  const last = viewPts[viewPts.length - 1];
  const shown = hover != null ? viewPts[hover] : last;
  const upC = shown ? Math.round(shown.up * 100) : null;
  const downC = upC == null ? null : 100 - upC;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!viewPts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tx = viewStart + (((e.clientX - r.left) / r.width) * W / plotW) * WIN_MS;
    let best = 0;
    for (let i = 1; i < viewPts.length; i++) if (Math.abs(viewPts[i].t - tx) < Math.abs(viewPts[best].t - tx)) best = i;
    setHover(best);
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const timeTicks = [0, 5, 10, 15].map((m) => viewStart + m * 60_000);
  const upLabelY = last ? y(last.up) : 0;
  const downLabelY = last ? y(1 - last.up) : 0;
  const sep = Math.abs(upLabelY - downLabelY) < 44;
  const upTop = last ? last.up >= 0.5 : true;
  const uy = sep ? (upTop ? Math.min(upLabelY, downLabelY) - 12 : Math.max(upLabelY, downLabelY) + 12) : upLabelY;
  const dy = sep ? (upTop ? Math.max(upLabelY, downLabelY) + 12 : Math.min(upLabelY, downLabelY) - 12) : downLabelY;

  const settled = (history.data ?? []).filter((h) => h.result && Date.parse(h.window_start) !== winStart);
  const gap = !sel && spot != null && strike != null ? spot - strike : null;

  return (
    <section className="border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Our odds · {sel ? "saved window" : "live UP vs DOWN"}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Price to beat </span>
            <span className="font-bold">{usd0(viewStrike)}</span>
            {sel ? (
              <span className="text-muted-foreground"> · closed {usd0(sel.close_spot)} · </span>
            ) : gap != null ? (
              <span className={cn(gap >= 0 ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
                {" "}· now {usd0(spot)} ({gap >= 0 ? "+" : ""}{gap.toFixed(0)})
              </span>
            ) : null}
            {sel?.result && (
              <span className={cn("font-bold", sel.result === "UP" ? "text-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)]")}>
                settled {sel.result}
              </span>
            )}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          {shown ? fmtTime(shown.t) : "waiting for odds…"} · window {fmtTime(viewStart)}–{fmtTime(viewStart + WIN_MS)}
          {sel && (
            <button onClick={() => { setSelected(null); setHover(null); }} className="px-2 py-0.5 border border-border rounded uppercase tracking-widest text-[10px] hover:bg-card">
              Back to live
            </button>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((p) => (
          <g key={p}>
            <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke="var(--color-border)" strokeDasharray={p === 0.5 ? "4 4" : "1 5"} />
            <text x={W - 4} y={y(p) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted-foreground)">{p * 100}%</text>
          </g>
        ))}
        {timeTicks.map((t, i) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize="11" fill="var(--color-muted-foreground)">{fmtTime(t)}</text>
        ))}
        {viewPts.length > 1 && (
          <>
            <path d={path((p) => 1 - p.up)} fill="none" stroke="var(--color-destructive)" strokeWidth={2} strokeLinejoin="round" />
            <path d={path((p) => p.up)} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
        {hover != null && viewPts[hover] && (
          <line x1={x(viewPts[hover].t)} x2={x(viewPts[hover].t)} y1={PAD_T} y2={PAD_T + plotH} stroke="var(--color-muted-foreground)" strokeDasharray="2 3" />
        )}
        {last && (
          <>
            <circle cx={x(last.t)} cy={y(last.up)} r={4} fill="var(--color-primary)">
              {!sel && <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite" />}
            </circle>
            <circle cx={x(last.t)} cy={y(1 - last.up)} r={4} fill="var(--color-destructive)">
              {!sel && <animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite" />}
            </circle>
            <g transform={`translate(${Math.min(x(last.t) + 10, plotW - 70)},0)`}>
              <text y={uy - 2} fontSize="12" fontWeight="600" fill="var(--color-primary)">Up</text>
              <text y={uy + 18} fontSize="20" fontWeight="700" fill="var(--color-primary)">{upC}¢</text>
              <text y={dy - 2} fontSize="12" fontWeight="600" fill="var(--color-destructive)">Down</text>
              <text y={dy + 18} fontSize="20" fontWeight="700" fill="var(--color-destructive)">{downC}¢</text>
            </g>
          </>
        )}
        {sel?.result && (
          <g transform={`translate(${plotW - 14},${sel.result === "UP" ? PAD_T + 14 : PAD_T + plotH - 14})`}>
            <circle r={11} fill={sel.result === "UP" ? "var(--color-primary)" : "var(--color-destructive)"} />
            {sel.result === "UP" ? (
              <path d="M-5 0 L-1.5 4 L5 -4" fill="none" stroke="var(--color-background)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M-4 -4 L4 4 M-4 4 L4 -4" fill="none" stroke="var(--color-background)" strokeWidth={2.5} strokeLinecap="round" />
            )}
          </g>
        )}
        {!viewPts.length && sel && (
          <text x={plotW / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="var(--color-muted-foreground)">No line recorded for this window</text>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Settled</span>
        {settled.length === 0 && <span className="text-[11px] text-muted-foreground">results appear here as windows close</span>}
        {settled.slice(0, 16).map((h) => {
          const isUp = h.result === "UP";
          const active = selected === h.window_start;
          return (
            <button
              key={h.window_start}
              onClick={() => { setSelected(active ? null : h.window_start); setHover(null); }}
              title={`${fmtTime(Date.parse(h.window_start))} · strike ${usd0(h.strike)} · close ${usd0(h.close_spot)}`}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold",
                isUp ? "text-[color:var(--color-primary)] border-[color:var(--color-primary)]" : "text-[color:var(--color-destructive)] border-[color:var(--color-destructive)]",
                active ? "bg-card" : "opacity-80 hover:opacity-100",
              )}
            >
              {isUp ? "▲" : "▼"} {fmtTime(Date.parse(h.window_start))}
            </button>
          );
        })}
      </div>
    </section>
  );
}
