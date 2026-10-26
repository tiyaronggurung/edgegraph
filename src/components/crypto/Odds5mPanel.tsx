import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { computeStrikeOdds, type Tick } from "@/hooks/useStrikeOdds";
import { fetchPolymarket5m } from "@/lib/polymarket5m.functions";
import { cn } from "@/lib/utils";

/**
 * Display-only 5-minute odds for Polymarket's btc-updown-5m windows.
 * Reuses the pure computeStrikeOdds core (no fork) with T = seconds left in
 * the 5m window. Strike = Polymarket's official price to beat (Chainlink open).
 * Never feeds Model, Study, auto-trade, exits or the 15m odds.
 */
const WIN_MS = 300_000;
const TAPE_MAX = 1200;
const W = 900, H = 160, PAD_R = 60;

export function Odds5mPanel({ spot }: { spot: number | null }) {
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
    if (last && t - last.t < 250) return;
    tape.push({ t, p: spot });
    if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
  }, [spot]);

  const k = strike?.win === winStart ? strike.px : null;
  const odds = computeStrikeOdds(spot, k, secsLeft, undefined, tapeRef.current);
  const up = odds.upAsk;

  const polyUp = poly && poly.startMs === winStart ? poly.upMid : null;
  const gap = up != null && polyUp != null ? up - polyUp : null;

  const ser = seriesRef.current;
  if (ser.win !== winStart) { ser.win = winStart; ser.pts = []; ser.poly = []; }
  if (up != null) {
    const lastPt = ser.pts[ser.pts.length - 1];
    if (!lastPt || now - lastPt.t >= 1000) ser.pts.push({ t: now, up });
  }
  if (polyUp != null) {
    const lastP = ser.poly[ser.poly.length - 1];
    if (!lastP || now - lastP.t >= 1000) ser.poly.push({ t: now, up: polyUp });
  }

  // Expiration-weighted area measured from the 50¢ midline.
  let aUp = 0, aDn = 0;
  for (let i = 1; i < ser.pts.length; i++) {
    const a = ser.pts[i - 1], b = ser.pts[i];
    const dt = Math.min((b.t - a.t) / 1000, 10);
    const left = Math.max(1, (winStart + WIN_MS - b.t) / 1000);
    const w = dt / Math.sqrt(left);
    const m = a.up - 0.5;
    if (m > 0) aUp += m * w; else aDn += -m * w;
  }
  const areaUp = aUp + aDn > 0 ? aUp / (aUp + aDn) : null;

  const x = (t: number) => ((t - winStart) / WIN_MS) * (W - PAD_R);
  const y = (p: number) => H - p * H;
  const mk = (pts: { t: number; up: number }[], f: (v: number) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(f(p.up)).toFixed(1)}`).join(" ");
  const upPath = mk(ser.pts, (v) => v);
  const dnPath = mk(ser.pts, (v) => 1 - v);
  const polyPath = mk(ser.poly, (v) => v);
  const lastPt = ser.pts[ser.pts.length - 1];
  const lastPoly = ser.poly[ser.poly.length - 1];

  return (
    <section className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-semibold">Our 5m odds · Polymarket window</div>
        <div className="text-muted-foreground font-mono">
          {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")} left · strike {k != null ? `$${k.toFixed(2)}` : "loading…"}
          {spot != null && k != null && ` (${spot - k >= 0 ? "+" : ""}${(spot - k).toFixed(0)})`}
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
      <div className="text-[10px] text-muted-foreground">
        Display only — same odds math as 15m with a 5-minute clock. Strike = Polymarket official "price to beat" (Chainlink BTC at the 5m open). Not used by any bot.
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
