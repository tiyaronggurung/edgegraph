// Panel comparing our real-time BTC UP/DOWN odds vs Kalshi's per-window,
// using the per-second snapshots logged into btc_kalshi_odds_snapshots.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listRecentWindowStats,
  listRecentOddsSnapshots,
  type OddsSnapshotRow,
  type OddsWindowStats,
} from "@/lib/kalshiOddsSnapshots.functions";

function fmtPct(v: number | null | undefined, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function fmtSignedPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(2);
  return v >= 0 ? `+${s}%` : `${s}%`;
}

export function OddsComparisonPanel() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const statsFn = useServerFn(listRecentWindowStats);
  const rowsFn = useServerFn(listRecentOddsSnapshots);

  const { data: statsData } = useQuery({
    queryKey: ["odds-snapshot-window-stats"],
    queryFn: () => statsFn({ data: { limit: 12 } }),
    refetchInterval: 15_000,
    staleTime: 12_000,
  });
  const windows: OddsWindowStats[] = statsData?.windows ?? [];
  const activeTicker = selected ?? windows[0]?.ticker ?? null;

  const { data: rowData } = useQuery({
    queryKey: ["odds-snapshot-rows", activeTicker],
    queryFn: () => rowsFn({ data: { ticker: activeTicker!, limit: 1200 } }),
    refetchInterval: 5_000,
    staleTime: 4_000,
    enabled: !!activeTicker,
  });
  const rows: OddsSnapshotRow[] = (rowData?.rows ?? []).slice().reverse(); // oldest → newest

  return (
    <div className="border border-white/10 rounded-lg bg-black/40 p-3">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-[11px] uppercase tracking-wider text-white/60">
          Our Odds vs Kalshi — Per-Second Snapshots
        </span>
        <span className="text-[10px] text-white/50">
          {windows.length} recent {windows.length === 1 ? "window" : "windows"}
        </span>
      </div>
      {!open ? null : (
        <div className="mt-3 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="text-white/50">
                <tr>
                  <th className="text-left pr-2 py-1">Ticker</th>
                  <th className="text-right px-2">Strike</th>
                  <th className="text-right px-2">Samples</th>
                  <th className="text-right px-2">Ours→</th>
                  <th className="text-right px-2">Kalshi→</th>
                  <th className="text-right px-2">Avg Δ</th>
                  <th className="text-right px-2">|Avg| Δ</th>
                  <th className="text-right px-2">Max Δ</th>
                  <th className="text-right px-2">Min Δ</th>
                </tr>
              </thead>
              <tbody>
                {windows.map(w => {
                  const isActive = w.ticker === activeTicker;
                  return (
                    <tr
                      key={w.ticker}
                      onClick={() => setSelected(w.ticker)}
                      className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${isActive ? "bg-cyan-500/10" : ""}`}
                    >
                      <td className="pr-2 py-1 text-white/80">{w.ticker.replace("KXBTC15M-", "")}</td>
                      <td className="text-right px-2 tabular-nums">${Number(w.strike).toFixed(0)}</td>
                      <td className="text-right px-2 tabular-nums">{w.samples}</td>
                      <td className="text-right px-2 tabular-nums">
                        {fmtPct(w.our_up_start, 0)}→{fmtPct(w.our_up_end, 0)}
                      </td>
                      <td className="text-right px-2 tabular-nums">
                        {fmtPct(w.kalshi_up_start, 0)}→{fmtPct(w.kalshi_up_end, 0)}
                      </td>
                      <td className={`text-right px-2 tabular-nums ${
                        w.avg_delta_up == null ? "text-white/40" :
                        w.avg_delta_up > 0 ? "text-emerald-300" : "text-rose-300"
                      }`}>{fmtSignedPct(w.avg_delta_up)}</td>
                      <td className="text-right px-2 tabular-nums">{fmtSignedPct(w.abs_avg_delta_up)}</td>
                      <td className="text-right px-2 tabular-nums text-emerald-300/80">{fmtSignedPct(w.max_delta_up)}</td>
                      <td className="text-right px-2 tabular-nums text-rose-300/80">{fmtSignedPct(w.min_delta_up)}</td>
                    </tr>
                  );
                })}
                {windows.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-white/40 py-3">
                    No snapshots yet — recorder runs in the background while this page is open.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {activeTicker && rows.length > 0 && (
            <div>
              <div className="text-[10px] text-white/50 mb-1">
                Last {rows.length} samples for <span className="text-white/80">{activeTicker}</span>
              </div>
              <MiniOddsChart rows={rows} />
              <div className="max-h-60 overflow-y-auto mt-2 border border-white/5 rounded">
                <table className="w-full text-[10px] font-mono">
                  <thead className="text-white/50 sticky top-0 bg-black/70">
                    <tr>
                      <th className="text-left px-2 py-1">Time</th>
                      <th className="text-right px-2">S→C</th>
                      <th className="text-right px-2">Spot</th>
                      <th className="text-right px-2">K bid/ask</th>
                      <th className="text-right px-2">K mid</th>
                      <th className="text-right px-2">Our mid</th>
                      <th className="text-right px-2">Δ (UP)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(-200).reverse().map(r => (
                      <tr key={r.id} className="border-t border-white/5">
                        <td className="px-2 py-0.5 text-white/70">
                          {new Date(r.snapped_at).toLocaleTimeString([], { hour12: false })}
                        </td>
                        <td className="text-right px-2 tabular-nums">{r.seconds_to_close ?? "—"}</td>
                        <td className="text-right px-2 tabular-nums">
                          {r.spot_composite != null ? `$${Number(r.spot_composite).toFixed(1)}` : "—"}
                        </td>
                        <td className="text-right px-2 tabular-nums text-white/60">
                          {r.kalshi_yes_bid != null && r.kalshi_yes_ask != null
                            ? `${(Number(r.kalshi_yes_bid) * 100).toFixed(0)}/${(Number(r.kalshi_yes_ask) * 100).toFixed(0)}¢`
                            : "—"}
                        </td>
                        <td className="text-right px-2 tabular-nums">{fmtPct(r.kalshi_yes_mid, 1)}</td>
                        <td className="text-right px-2 tabular-nums">{fmtPct(r.our_mid, 1)}</td>
                        <td className={`text-right px-2 tabular-nums ${
                          r.delta_up == null ? "text-white/40" :
                          r.delta_up > 0 ? "text-emerald-300" : "text-rose-300"
                        }`}>{fmtSignedPct(r.delta_up)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniOddsChart({ rows }: { rows: OddsSnapshotRow[] }) {
  const W = 640, H = 120, P = 6;
  const pts = rows.filter(r => r.our_mid != null && r.kalshi_yes_mid != null);
  if (pts.length < 2) return <div className="text-[10px] text-white/40">Charting requires ≥2 samples.</div>;
  const xs = pts.map(r => new Date(r.snapped_at).getTime());
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const dx = Math.max(1, x1 - x0);
  const sx = (t: number) => P + ((t - x0) / dx) * (W - 2 * P);
  const sy = (p: number) => P + (1 - p) * (H - 2 * P);
  const path = (getY: (r: OddsSnapshotRow) => number | null, color: string) => {
    let d = "";
    for (const r of pts) {
      const y = getY(r);
      if (y == null) continue;
      const x = sx(new Date(r.snapped_at).getTime());
      const py = sy(y);
      d += (d ? " L " : "M ") + `${x.toFixed(1)} ${py.toFixed(1)}`;
    }
    return <path d={d} stroke={color} strokeWidth={1.4} fill="none" />;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24 bg-black/40 border border-white/5 rounded">
      {/* 50% ref line */}
      <line x1={P} x2={W - P} y1={sy(0.5)} y2={sy(0.5)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
      {path(r => r.kalshi_yes_mid, "rgb(56, 189, 248)")}
      {path(r => r.our_mid, "rgb(52, 211, 153)")}
      <g fontSize={9} fontFamily="monospace">
        <text x={W - P} y={P + 8} textAnchor="end" fill="rgb(56, 189, 248)">Kalshi</text>
        <text x={W - P} y={P + 20} textAnchor="end" fill="rgb(52, 211, 153)">Ours</text>
      </g>
    </svg>
  );
}
