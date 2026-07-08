import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFlipRecorderData, type FlipWindow } from "@/lib/flipRecorder.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, Activity, Zap } from "lucide-react";

// SHADOW-ONLY. Records ATM YES/NO odds across each 15-min window and shows
// leader/flip stats + historical leader-win rate by time-to-close. Never
// touches buy or exit logic.

function fmtSec(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m${r}s` : `${m}m`;
}

function LeaderChip({ side, small = false }: { side: "YES" | "NO" | "TIE" | null; small?: boolean }) {
  if (!side || side === "TIE") return <span className="text-muted-foreground text-xs">—</span>;
  const isYes = side === "YES";
  const cls = isYes
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-red-500/40 bg-red-500/10 text-red-300";
  const Icon = isYes ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono ${cls} ${small ? "text-[10px]" : "text-xs"}`}>
      <Icon className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {side}
    </span>
  );
}

function Sparkline({ snaps }: { snaps: FlipWindow["snaps"] }) {
  if (snaps.length < 2) return null;
  const W = 260, H = 40;
  const maxT = snaps[snaps.length - 1].t || 1;
  const pts = snaps.map(s => {
    const x = (s.t / maxT) * W;
    const y = H - (s.yes / 100) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const midY = H / 2;
  return (
    <svg width={W} height={H} className="block">
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="hsl(var(--border))" strokeDasharray="2 2" />
      <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" />
    </svg>
  );
}

function WindowRow({ w }: { w: FlipWindow }) {
  const dur = w.yesLeadSec + w.noLeadSec || 1;
  const yesPct = Math.round((w.yesLeadSec / dur) * 100);
  const noPct = 100 - yesPct;
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-mono truncate">{w.ticker}</div>
          <div className="text-[10px] text-muted-foreground">
            strike ${w.strike.toFixed(0)} · spot ${w.spot?.toFixed(0) ?? "—"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {w.isOpen ? (
            <Badge variant="outline" className="text-[10px]">T-{fmtSec(w.secondsToClose)}</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">closed</Badge>
          )}
          <Badge
            variant="outline"
            className={`text-[10px] ${
              w.stability === "choppy"
                ? "border-amber-500/40 text-amber-300"
                : w.stability === "stable"
                ? "border-emerald-500/40 text-emerald-300"
                : ""
            }`}
          >
            {w.stability === "choppy" ? <><Zap className="h-2.5 w-2.5 mr-0.5" />choppy</> : w.stability}
          </Badge>
        </div>
      </div>

      <Sparkline snaps={w.snaps} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
        <div>lead: <LeaderChip side={w.currentLeader} small /></div>
        <div>first: <LeaderChip side={w.firstLeader} small /></div>
        <div>flips: <span className={w.flipCount >= 3 ? "text-amber-300" : ""}>{w.flipCount}</span></div>
        <div>last flip: {fmtSec(w.lastFlipAgoSec)}</div>
        {!w.isOpen && (
          <>
            <div>final: <LeaderChip side={w.finalLeader} small /></div>
            <div>max false lead: <span className={w.maxFalseLeadSec && w.maxFalseLeadSec > 120 ? "text-red-300" : ""}>{fmtSec(w.maxFalseLeadSec)}</span></div>
          </>
        )}
      </div>

      <div className="h-1.5 rounded bg-muted overflow-hidden flex" title={`YES ${yesPct}% · NO ${noPct}%`}>
        <div className="bg-emerald-500/60" style={{ width: `${yesPct}%` }} />
        <div className="bg-red-500/60" style={{ width: `${noPct}%` }} />
      </div>

      <div className="grid grid-cols-6 gap-1 text-[10px] font-mono">
        {w.checkpoints.map(c => (
          <div key={c.label} className="text-center">
            <div className="text-muted-foreground">{c.label}</div>
            <div>
              {c.yes != null ? `${c.yes}¢` : "—"}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function FlipRecorderPanel() {
  const fn = useServerFn(getFlipRecorderData);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["flipRecorder"],
    queryFn: () => fn(),
    refetchInterval: 15_000,
  });

  const payload = data && data.ok ? data.payload : null;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Flip Recorder <span className="text-muted-foreground font-normal">· shadow</span></h3>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Records ATM YES/NO tape across each 15-min window. Read-only — no trades.
          </p>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {isFetching ? "syncing…" : payload ? `${payload.windows.length} recent · ${payload.totalWindowsStudied} closed studied` : ""}
        </div>
      </div>

      {payload && payload.historicalLeaderWins.length > 0 && (
        <div className="rounded border p-2">
          <div className="text-[11px] font-semibold mb-1">Historical leader-wins by time-to-close</div>
          <div className="grid grid-cols-5 gap-1 text-[10px] font-mono">
            {payload.historicalLeaderWins.map(b => {
              const color =
                b.leaderWinsPct >= 95 ? "text-emerald-300"
                : b.leaderWinsPct >= 85 ? "text-emerald-400/80"
                : b.leaderWinsPct >= 70 ? "text-amber-300"
                : "text-muted-foreground";
              return (
                <div key={b.bucket} className="text-center">
                  <div className="text-muted-foreground">{b.bucket}</div>
                  <div className={`text-sm font-semibold ${color}`}>{b.leaderWinsPct}%</div>
                  <div className="text-muted-foreground">n={b.n}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading && !payload && <div className="text-xs text-muted-foreground">loading tape…</div>}
      {payload && payload.windows.length === 0 && (
        <div className="text-xs text-muted-foreground">No tape rows in last 6h. The snapshotter feeds this panel — leave the crypto page open to accumulate data.</div>
      )}

      {payload && payload.windows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {payload.windows.slice(0, 12).map(w => (
            <WindowRow key={w.ticker} w={w} />
          ))}
        </div>
      )}
    </Card>
  );
}
