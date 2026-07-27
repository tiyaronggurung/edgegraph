// Per-window UP-vs-DOWN study: live confidence call + historical grid of
// (lock threshold × time-remaining when first crossed) → win rate, so we can
// engineer the lock rule from data instead of guessing.
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOddsSideStudy, getLockThresholdStudy, type SideStudyRow, type LiveHold, type SideStudySummary, type LockCell } from "@/lib/kalshiOddsSnapshots.functions";


function pct(v: number | null | undefined, d = 0) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

function sideBadge(side: SideStudyRow["our_side"] | LiveHold["recommendation"] | null) {
  if (!side) return "text-white/40";
  const s = String(side);
  if (s.includes("UP")) return "text-emerald-300";
  if (s.includes("DOWN")) return "text-rose-300";
  return "text-amber-300";
}

export function OddsSideStudyPanel() {
  const fn = useServerFn(getOddsSideStudy);
  const { data } = useQuery({
    queryKey: ["odds-side-study"],
    queryFn: () => fn({ data: { hours: 12, limit: 60 } }),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
  const lockRef = useRef<{ ticker: string; side: "UP" | "DOWN"; prob: number } | null>(null);


  const rows: SideStudyRow[] = data?.rows ?? [];
  const summary: SideStudySummary | undefined = data?.summary;
  const live: LiveHold | undefined = data?.live;

  return (
    <div className="border border-white/10 rounded-lg bg-black/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-white/60">
          UP vs DOWN — Our Odds Side Study
        </span>
        <span className="text-[10px] text-white/50">last 12h · {rows.length} windows</span>
      </div>

      {/* Live confidence call — locks side once conviction first crosses 88%. */}
      {live && (() => {
        const LOCK_THRESHOLD = 0.88;
        const SKIP_THRESHOLD = 0.55;
        const p = live.our_mid;
        const liveProb = p == null ? null : Math.max(p, 1 - p);
        const liveDir: "UP" | "DOWN" | null = p == null ? null : p >= 0.5 ? "UP" : "DOWN";
        const tickerKey = live.ticker ?? "";

        // Reset lock when ticker rolls to a new window.
        if (lockRef.current && lockRef.current.ticker !== tickerKey) {
          lockRef.current = null;
        }
        // Arm lock the first time conviction crosses the threshold this window.
        if (!lockRef.current && tickerKey && liveProb != null && liveDir && liveProb >= LOCK_THRESHOLD) {
          lockRef.current = { ticker: tickerKey, side: liveDir, prob: liveProb };
        }

        const locked = lockRef.current && lockRef.current.ticker === tickerKey ? lockRef.current : null;
        const displaySide = locked ? locked.side : liveDir;
        const displayProb = locked ? locked.prob : liveProb;
        const isSkip = !locked && (displayProb == null || displayProb < SKIP_THRESHOLD);

        const call =
          displayProb == null ? "—"
          : isSkip ? "SKIP"
          : `${displaySide} ${(displayProb * 100).toFixed(0)}%${locked ? " 🔒" : ""}`;
        const callClass =
          isSkip || displayProb == null ? "text-amber-300"
          : displaySide === "UP" ? "text-emerald-300" : "text-rose-300";
        return (
          <div className="mt-3 flex items-center gap-3 p-2 rounded border border-white/10 bg-black/40">
            <div className={`text-lg font-bold font-mono ${callClass}`}>{call}</div>
            <div className="flex-1 text-[11px] font-mono text-white/70">
              <div>
                {live.ticker ? live.ticker.replace("KXBTC15M-", "") : "—"}
                {live.strike != null ? <span className="text-white/40"> · ${live.strike.toFixed(0)}</span> : null}
                {live.seconds_to_close != null ? <span className="text-white/40"> · {live.seconds_to_close}s left</span> : null}
              </div>
              <div className="text-white/50">
                {locked
                  ? `Locked ${locked.side} at ${(locked.prob * 100).toFixed(0)}% — held for rest of window`
                  : live.reason}
              </div>
            </div>
            <div className="text-[10px] font-mono text-right text-white/60">
              <div>Ours {pct(live.our_mid, 0)}</div>
              <div>Kalshi {pct(live.kalshi_mid, 0)}</div>
              <div className="text-white/40">conv {live.confidence != null ? (live.confidence * 100).toFixed(0) + "%" : "—"}</div>
            </div>
          </div>
        );
      })()}



      {/* Summary */}
      {summary && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] font-mono">
          <div className="p-2 rounded bg-white/5">
            <div className="text-white/50">Our WR</div>
            <div className="text-emerald-300 text-sm">{pct(summary.our_wr, 1)}</div>
          </div>
          <div className="p-2 rounded bg-white/5">
            <div className="text-white/50">Kalshi WR</div>
            <div className="text-sky-300 text-sm">{pct(summary.kalshi_wr, 1)}</div>
          </div>
          <div className="p-2 rounded bg-white/5">
            <div className="text-white/50">Agree WR</div>
            <div className="text-emerald-300 text-sm">{pct(summary.agree_wr, 1)}</div>
          </div>
          <div className="p-2 rounded bg-white/5">
            <div className="text-white/50">Disagree · Ours</div>
            <div className="text-amber-300 text-sm">{pct(summary.disagree_our_wr, 1)}</div>
          </div>
          <div className="p-2 rounded bg-white/5">
            <div className="text-white/50">High Conv (≥40%)</div>
            <div className="text-emerald-300 text-sm">{pct(summary.high_conv_wr, 1)}</div>
          </div>
        </div>
      )}

      {/* Per-window rows */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead className="text-white/50">
            <tr>
              <th className="text-left pr-2 py-1">Window</th>
              <th className="text-right px-2">Winner</th>
              <th className="text-right px-2">Ours (final)</th>
              <th className="text-right px-2">Kalshi (final)</th>
              <th className="text-right px-2">Ours pick</th>
              <th className="text-right px-2">Kalshi pick</th>
              <th className="text-right px-2">Ours ✓</th>
              <th className="text-right px-2">Kalshi ✓</th>
              <th className="text-right px-2">UP share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ticker} className="border-t border-white/5">
                <td className="pr-2 py-1 text-white/80">
                  {new Date(r.close_time).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}
                  <span className="text-white/40"> · ${r.strike.toFixed(0)}</span>
                </td>
                <td className={`text-right px-2 ${sideBadge(r.winner)}`}>{r.winner ?? "—"}</td>
                <td className="text-right px-2 tabular-nums">{pct(r.our_final_mid, 0)}</td>
                <td className="text-right px-2 tabular-nums text-white/60">{pct(r.kalshi_final_mid, 0)}</td>
                <td className={`text-right px-2 ${sideBadge(r.our_side)}`}>{r.our_side ?? "—"}</td>
                <td className={`text-right px-2 ${sideBadge(r.kalshi_side)}`}>{r.kalshi_side ?? "—"}</td>
                <td className={`text-right px-2 ${r.our_correct === true ? "text-emerald-300" : r.our_correct === false ? "text-rose-300" : "text-white/40"}`}>
                  {r.our_correct == null ? "—" : r.our_correct ? "✓" : "✗"}
                </td>
                <td className={`text-right px-2 ${r.kalshi_correct === true ? "text-emerald-300" : r.kalshi_correct === false ? "text-rose-300" : "text-white/40"}`}>
                  {r.kalshi_correct == null ? "—" : r.kalshi_correct ? "✓" : "✗"}
                </td>
                <td className="text-right px-2 tabular-nums text-white/60">
                  O {pct(r.our_up_share, 0)} · K {pct(r.kalshi_up_share, 0)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-white/40 py-3">
                No settled snapshot-covered windows yet. Keep the chart open to accumulate data.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Threshold × Time-Remaining Study ----------
export function LockThresholdStudyPanel() {
  const fn = useServerFn(getLockThresholdStudy);
  const { data } = useQuery({
    queryKey: ["lock-threshold-study"],
    queryFn: () => fn({ data: { hours: 168 } }),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  const cells: LockCell[] = data?.cells ?? [];
  const covered = data?.covered_windows ?? 0;
  const BUCKETS = ["≥10m", "5-10m", "2-5m", "30s-2m", "<30s"];
  const THRS = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90];
  const get = (thr: number, b: string) => cells.find(c => c.threshold === thr && c.bucket === b);

  // Best cell: needs meaningful sample size.
  const MIN_N = 10;
  const best = cells
    .filter(c => c.windows >= MIN_N && c.wr != null)
    .sort((a, b) => (b.wr! - a.wr!) || (b.windows - a.windows))[0];

  const cellColor = (wr: number | null, n: number) => {
    if (wr == null) return "text-white/25";
    if (n < 3) return "text-white/40";
    if (wr >= 0.80) return "text-emerald-300 font-bold";
    if (wr >= 0.65) return "text-emerald-400";
    if (wr >= 0.55) return "text-amber-300";
    return "text-rose-300";
  };

  return (
    <div className="border border-white/10 rounded-lg bg-black/40 p-3 mt-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-white/60">
          Lock Threshold Study — WR by first-cross time
        </span>
        <span className="text-[10px] text-white/50">last 7d · {covered} settled windows w/ snapshots</span>
      </div>

      {best ? (
        <div className="mt-2 text-[11px] font-mono text-emerald-300">
          Best rule (n≥{MIN_N}): first cross ≥{(best.threshold * 100).toFixed(0)}% during {best.bucket} →
          {" "}{(best.wr! * 100).toFixed(1)}% WR ({best.wins}/{best.windows})
        </div>
      ) : (
        <div className="mt-2 text-[11px] font-mono text-white/40">
          Not enough coverage yet — need at least {MIN_N} windows per cell before any rule is trustworthy.
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead className="text-white/50">
            <tr>
              <th className="text-left pr-2 py-1">Threshold</th>
              {BUCKETS.map(b => <th key={b} className="text-right px-2">{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {THRS.map(thr => (
              <tr key={thr} className="border-t border-white/5">
                <td className="pr-2 py-1 text-white/80">≥ {(thr * 100).toFixed(0)}%</td>
                {BUCKETS.map(b => {
                  const c = get(thr, b);
                  const wr = c?.wr ?? null;
                  const n = c?.windows ?? 0;
                  return (
                    <td key={b} className={`text-right px-2 tabular-nums ${cellColor(wr, n)}`}>
                      {wr == null ? "—" : `${(wr * 100).toFixed(0)}%`}
                      <span className="text-white/30 ml-1">({n})</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] text-white/40">
        Cell = win-rate when side-conviction first crosses that threshold during that time window. Grey = &lt;3 samples.
      </div>
    </div>
  );
}
