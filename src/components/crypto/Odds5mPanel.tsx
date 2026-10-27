import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { computeStrikeOdds, type Tick, type StrikeOddsContext } from "@/hooks/useStrikeOdds";
import { fetchPolymarket5m } from "@/lib/polymarket5m.functions";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;
type Saved5m = { window_start: string; strike: number | null; close_spot: number | null; result: string | null; points: [number, number][]; poly_points: [number, number][] };
const enc = (pts: { t: number; up: number }[], ws: number) => pts.map((p) => [Math.round((p.t - ws) / 1000), Math.round(p.up * 1000)] as [number, number]);
const dec = (pts: [number, number][], ws: number) => (pts ?? []).map(([s, u]) => ({ t: ws + s * 1000, up: u / 1000 }));

/**
 * Display-only 5-minute odds for Polymarket's btc-updown-5m windows.
 * Reuses the pure computeStrikeOdds core (no fork) with T = seconds left in
 * the 5m window. Strike = Polymarket's official price to beat (Chainlink open).
 * Never feeds Model, Study, auto-trade, exits or the 15m odds.
 */
const WIN_MS = 300_000;
const TAPE_MAX = 1200;
const W = 900, H = 160, PAD_R = 60;

export function Odds5mPanel({ spot, ctx }: { spot: number | null; ctx?: StrikeOddsContext }) {
  const pollFn = useServerFn(fetchPolymarket5m);
  const [now, setNow] = useState(Date.now());
  const winStart = Math.floor(now / WIN_MS) * WIN_MS;
  const secsLeft = Math.max(0, Math.round((winStart + WIN_MS - now) / 1000));
  const [strike, setStrike] = useState<{ win: number; px: number } | null>(null);
  const [poly, setPoly] = useState<Awaited<ReturnType<typeof fetchPolymarket5m>> | null>(null);
  const tapeRef = useRef<Tick[]>([]);
  const seriesRef = useRef<{ win: number; pts: { t: number; up: number }[]; poly: { t: number; up: number }[] }>({ win: -1, pts: [], poly: [] });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Official Polymarket strike (Chainlink "price to beat") + live UP mid, 2s poll.
  useEffect(() => {
    let cancelled = false;
    const tick = () => pollFn({ data: { startMs: winStart } }).then((r) => {
      if (cancelled || r.startMs !== winStart) return;
      setPoly(r);
      if (r.strike != null) setStrike({ win: winStart, px: r.strike });
    }).catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollFn, winStart]);

  // Price tape (~1 sample / 250ms).
  useEffect(() => {
    if (spot == null || !(spot > 0)) return;
    const t = Date.now();
    const tape = tapeRef.current;
    const last = tape[tape.length - 1];
    if (last && t - last.t < 100) return;
    tape.push({ t, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
  }, [spot]);

  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const history = useQuery({
    queryKey: ["live-odds-windows-5m"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await db.from("live_odds_windows_5m").select("*").order("window_start", { ascending: false }).limit(48);
      return (data ?? []) as Saved5m[];
    },
  });
  const latestRef = useRef<{ k: number | null; spot: number | null }>({ k: null, spot: null });
  const finalRef = useRef<{ win: number; pts: { t: number; up: number }[]; poly: { t: number; up: number }[]; k: number | null; spot: number | null } | null>(null);

  // Save this 5m window's own history (separate table from 15m). Merges with any
  // existing row so a reload never shortens a recording. Display data only.
  const save5m = async (ws: number, pts: { t: number; up: number }[], poly: { t: number; up: number }[], k: number | null, s: number | null, final: boolean) => {
    if (!pts.length) return;
    const iso = new Date(ws).toISOString();
    const { data: ex } = await db.from("live_odds_windows_5m").select("points,poly_points,result").eq("window_start", iso).maybeSingle();
    const m = (a: [number, number][], b: [number, number][]) => { const mp = new Map<number, number>(); for (const [x, y] of a ?? []) mp.set(x, y); for (const [x, y] of b) mp.set(x, y); return [...mp.entries()].sort((p, q) => p[0] - q[0]); };
    const row: Record<string, unknown> = { window_start: iso, updated_at: new Date().toISOString(), points: m(ex?.points, enc(pts, ws)), poly_points: m(ex?.poly_points, enc(poly, ws)) };
    if (k != null) row.strike = k;
    if (final && !ex?.result) {
      const { data: bw } = await db.from("p5_windows").select("result,close_spot").eq("window_start", iso).maybeSingle();
      if (bw?.result === "UP" || bw?.result === "DOWN") { row.result = bw.result; row.close_spot = bw.close_spot; }
      else if (k != null && s != null) { row.result = s >= k ? "UP" : "DOWN"; row.close_spot = s; }
    }
    await db.from("live_odds_windows_5m").upsert(row, { onConflict: "window_start" });
  };

  useEffect(() => {
    const id = setInterval(() => {
      const ser = seriesRef.current;
      if (ser.win > 0) void save5m(ser.win, ser.pts, ser.poly, latestRef.current.k, latestRef.current.spot, false).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const f = finalRef.current;
    if (!f) return;
    finalRef.current = null;
    void save5m(f.win, f.pts, f.poly, f.k, f.spot, true).then(() => qc.invalidateQueries({ queryKey: ["live-odds-windows-5m"] })).catch(() => {});
  }, [winStart, qc]);
  // Fill results for windows that closed while the page was shut (from the bot's settled window).
  useEffect(() => {
    const pend = (history.data ?? []).filter((h) => !h.result && Date.parse(h.window_start) + WIN_MS < Date.now());
    if (!pend.length) return;
    void (async () => {
      for (const h of pend) {
        const { data: bw } = await db.from("p5_windows").select("result,close_spot").eq("window_start", h.window_start).maybeSingle();
        if (bw?.result === "UP" || bw?.result === "DOWN") await db.from("live_odds_windows_5m").update({ result: bw.result, close_spot: bw.close_spot }).eq("window_start", h.window_start);
      }
    })().catch(() => {});
  }, [history.data]);

  const k = strike?.win === winStart ? strike.px : null;
  // Same engine as 15m, now with 1m/15m indicators, SMA stack and last-3-min taker flow tilted in.
  const odds = computeStrikeOdds(spot, k, secsLeft, { ...ctx, windowSec: 300 }, tapeRef.current);
  const up = odds.upAsk;

  const polyUp = poly && poly.startMs === winStart ? poly.upMid : null;
  const gap = up != null && polyUp != null ? up - polyUp : null;

  const ser = seriesRef.current;
  latestRef.current = { k, spot };
  if (ser.win !== winStart && ser.win > 0 && ser.pts.length) finalRef.current = { win: ser.win, pts: ser.pts, poly: ser.poly, k: strike?.win === ser.win ? strike.px : null, spot };
  if (ser.win !== winStart) { ser.win = winStart; ser.pts = []; ser.poly = []; }
  if (up != null) {
    // Line endpoint follows every odds update instantly; new vertex every 250ms.
    const tNow = Date.now();
    const lastPt = ser.pts[ser.pts.length - 1];
    if (!lastPt || tNow - lastPt.t >= 250) ser.pts.push({ t: tNow, up });
    else lastPt.up = up;
  }
  if (polyUp != null) {
    const lastP = ser.poly[ser.poly.length - 1];
    if (!lastP || now - lastP.t >= 1000) ser.poly.push({ t: now, up: polyUp });
  }

  const past = sel ? (history.data ?? []).find((h) => h.window_start === sel) ?? null : null;
  const viewWs = past ? Date.parse(past.window_start) : winStart;
  const viewPts = past ? dec(past.points, viewWs) : ser.pts;
  const viewPoly = past ? dec(past.poly_points, viewWs) : ser.poly;

  // Expiration-weighted area measured from the 50¢ midline.
  let aUp = 0, aDn = 0;
  for (let i = 1; i < viewPts.length; i++) {
    const a = viewPts[i - 1], b = viewPts[i];
    const dt = Math.min((b.t - a.t) / 1000, 10);
    const left = Math.max(1, (viewWs + WIN_MS - b.t) / 1000);
    const w = dt / Math.sqrt(left);
    const m = a.up - 0.5;
    if (m > 0) aUp += m * w; else aDn += -m * w;
  }
  const areaUp = aUp + aDn > 0 ? aUp / (aUp + aDn) : null;

  const x = (t: number) => ((t - viewWs) / WIN_MS) * (W - PAD_R);
  const y = (p: number) => H - p * H;
  const mk = (pts: { t: number; up: number }[], f: (v: number) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(f(p.up)).toFixed(1)}`).join(" ");
  const upPath = mk(viewPts, (v) => v);
  const dnPath = mk(viewPts, (v) => 1 - v);
  const polyPath = mk(viewPoly, (v) => v);
  const lastPt = viewPts[viewPts.length - 1];
  const lastPoly = viewPoly[viewPoly.length - 1];
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

  return (
    <section className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-semibold">Our 5m odds · Polymarket window</div>
        <div className="text-muted-foreground font-mono">
          {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")} left · strike {k != null ? `$${k.toFixed(2)}` : "loading…"}
          {spot != null && <> · BTC ${spot.toFixed(2)}</>}
          {spot != null && k != null && <span className={spot - k >= 0 ? "text-success" : "text-destructive"}> · Δ {spot - k >= 0 ? "+" : "−"}${Math.abs(spot - k).toFixed(2)}</span>}
          {ctx?.win5VolIn != null && ctx?.win5VolOut != null && <> · 5m flow In {ctx.win5VolIn.toFixed(1)} / Out {ctx.win5VolOut.toFixed(1)} BTC</>}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Box label="Our UP" value={up != null ? `${(up * 100).toFixed(1)}¢` : "—"} tone="up" />
        <Box label="Our DOWN" value={up != null ? `${((1 - up) * 100).toFixed(1)}¢` : "—"} tone="down" />
        <Box
          label="Polymarket UP"
          value={polyUp != null ? `${(polyUp * 100).toFixed(1)}¢` : "offline"}
          sub={gap != null ? `Δ ${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)}¢ vs ours` : undefined}
        />
        <Box
          label="Area (from 50¢)"
          value={areaUp != null ? `${(areaUp * 100).toFixed(0)}% UP / ${((1 - areaUp) * 100).toFixed(0)}% DN` : "—"}
        />
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-primary" />Our UP</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-destructive" />Our DOWN</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-foreground" />Polymarket UP</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 bg-muted/10 rounded">
        <line x1={0} x2={W - PAD_R} y1={y(0.5)} y2={y(0.5)} className="stroke-muted-foreground/40" strokeDasharray="4 4" />
        {polyPath && <path d={polyPath} fill="none" className="stroke-foreground/70" strokeWidth={1.5} strokeDasharray="5 3" />}
        {dnPath && <path d={dnPath} fill="none" className="stroke-destructive" strokeWidth={2} />}
        {upPath && <path d={upPath} fill="none" className="stroke-primary" strokeWidth={2} />}
        {lastPt && (
          <>
            <circle cx={x(lastPt.t)} cy={y(lastPt.up)} r={4} className="fill-primary" />
            <text x={x(lastPt.t) + 8} y={y(lastPt.up) + 4} className="fill-primary text-[14px] font-mono">
              {(lastPt.up * 100).toFixed(0)}¢
            </text>
            <circle cx={x(lastPt.t)} cy={y(1 - lastPt.up)} r={4} className="fill-destructive" />
            <text x={x(lastPt.t) + 8} y={y(1 - lastPt.up) + 4} className="fill-destructive text-[14px] font-mono">
              {((1 - lastPt.up) * 100).toFixed(0)}¢
            </text>
          </>
        )}
        {lastPoly && <circle cx={x(lastPoly.t)} cy={y(lastPoly.up)} r={3} className="fill-foreground/70" />}
      </svg>
      {past && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono">Replay {fmtT(past.window_start)} · strike {past.strike != null ? `$${Number(past.strike).toFixed(2)}` : "—"} · close {past.close_spot != null ? `$${Number(past.close_spot).toFixed(2)}` : "—"} · {past.result ?? "pending"}</span>
          <button onClick={() => setSel(null)} className="px-2 py-0.5 rounded border border-border">Back to live</button>
        </div>
      )}
      <div className="flex gap-1 text-xs">
        <button onClick={() => setShowPast(false)} className={cn("px-2 py-0.5 rounded border border-border", !showPast && "bg-muted")}>Chart</button>
        <button onClick={() => setShowPast(true)} className={cn("px-2 py-0.5 rounded border border-border", showPast && "bg-muted")}>Past windows</button>
      </div>
      {showPast && (
        <div className="max-h-64 overflow-auto border border-border rounded">
          <table className="w-full font-mono text-[11px]">
            <thead className="text-muted-foreground sticky top-0 bg-background"><tr><th className="text-left px-2">Window (NY)</th><th>Strike</th><th>Close</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {(history.data ?? []).filter((h) => h.result && Date.parse(h.window_start) !== winStart).map((h) => (
                <tr key={h.window_start} className={cn("border-t border-border/40", sel === h.window_start && "bg-muted")}>
                  <td className="px-2">{fmtT(h.window_start)}</td>
                  <td className="text-center">{h.strike != null ? `$${Number(h.strike).toFixed(2)}` : "—"}</td>
                  <td className="text-center">{h.close_spot != null ? `$${Number(h.close_spot).toFixed(2)}` : "—"}</td>
                  <td className={cn("text-center", h.result === "UP" ? "text-primary" : "text-destructive")}>{h.result === "UP" ? "▲ UP" : "▼ DOWN"}</td>
                  <td className="text-right px-2"><button onClick={() => { setSel(h.window_start); setShowPast(false); }} className="px-1.5 rounded border border-border">Replay</button></td>
                </tr>
              ))}
              {!(history.data ?? []).some((h) => h.result) && <tr><td colSpan={5} className="px-2 py-2 text-muted-foreground">No settled windows yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        Display only — same odds math as 15m with a 5-minute clock, including 1m/15m RSI·MACD·SMA, the SMA 10/50/200 stack and last-3-min taker flow. Not used by any bot.
      </div>
    </section>
  );
}

function Box({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("font-bold tabular-nums", tone === "up" && "text-[color:var(--color-primary)]", tone === "down" && "text-[color:var(--color-destructive)]")}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
