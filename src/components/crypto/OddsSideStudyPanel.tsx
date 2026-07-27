// Per-window UP-vs-DOWN study: live confidence call + historical grid of
// (lock threshold × time-remaining when first crossed) → win rate, so we can
// engineer the lock rule from data instead of guessing.
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

      {/* Live confidence call */}
      {live && <LiveCall live={live} />}


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

const LOCK_THRESHOLD = 0.70; // once side prob hits this, lock the call for the rest of the window
const SKIP_THRESHOLD = 0.55;

function LiveCall({ live }: { live: LiveHold }) {
  // Persist the first side that crosses LOCK_THRESHOLD per ticker.
  const lockRef = useRef<Map<string, { side: "UP" | "DOWN"; prob: number }>>(new Map());
  const [, force] = useState(0);

  useEffect(() => {
    if (!live.ticker || live.our_mid == null) return;
    const sideProb = Math.max(live.our_mid, 1 - live.our_mid);
    const sideDir: "UP" | "DOWN" = live.our_mid >= 0.5 ? "UP" : "DOWN";
    const existing = lockRef.current.get(live.ticker);
    if (!existing && sideProb >= LOCK_THRESHOLD) {
      lockRef.current.set(live.ticker, { side: sideDir, prob: sideProb });
      // Prune to last 20 tickers to avoid unbounded growth.
      if (lockRef.current.size > 20) {
        const first = lockRef.current.keys().next().value;
        if (first) lockRef.current.delete(first);
      }
      force(x => x + 1);
    }
  }, [live.ticker, live.our_mid]);

  const p = live.our_mid;
  const locked = live.ticker ? lockRef.current.get(live.ticker) : undefined;
  const sideProb = p == null ? null : Math.max(p, 1 - p);
  const sideDir: "UP" | "DOWN" | null = p == null ? null : p >= 0.5 ? "UP" : "DOWN";

  const displaySide = locked?.side ?? sideDir;
  const displayProb = locked?.prob ?? sideProb;
  const isLocked = !!locked;
  const skip = !isLocked && (sideProb == null || sideProb < SKIP_THRESHOLD);

  const call =
    displayProb == null ? "—"
    : skip ? "SKIP"
    : `${displaySide} ${(displayProb * 100).toFixed(0)}%${isLocked ? " 🔒" : ""}`;
  const callClass =
    skip || displayProb == null ? "text-amber-300"
    : displaySide === "UP" ? "text-emerald-300" : "text-rose-300";

  const reason = isLocked
    ? `Locked at ${(locked!.prob * 100).toFixed(0)}% — holding for rest of window`
    : live.reason;

  return (
    <div className="mt-3 flex items-center gap-3 p-2 rounded border border-white/10 bg-black/40">
      <div className={`text-lg font-bold font-mono ${callClass}`}>{call}</div>
      <div className="flex-1 text-[11px] font-mono text-white/70">
        <div>
          {live.ticker ? live.ticker.replace("KXBTC15M-", "") : "—"}
          {live.strike != null ? <span className="text-white/40"> · ${live.strike.toFixed(0)}</span> : null}
          {live.seconds_to_close != null ? <span className="text-white/40"> · {live.seconds_to_close}s left</span> : null}
        </div>
        <div className="text-white/50">{reason}</div>
      </div>
      <div className="text-[10px] font-mono text-right text-white/60">
        <div>Ours {pct(live.our_mid, 0)}</div>
        <div>Kalshi {pct(live.kalshi_mid, 0)}</div>
        <div className="text-white/40">conv {live.confidence != null ? (live.confidence * 100).toFixed(0) + "%" : "—"}</div>
      </div>
    </div>
  );
}
