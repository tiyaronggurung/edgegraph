import { useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const GOAL = 100_000;
const HORIZON_DAYS = 100;
const DEFAULT_START_DATE = "2026-08-21";
// Reconstructed Aug 21, 2026 Kalshi cash balance (start of the 100-day run):
// current $9,877.43 − ~$4,597 P/L earned Aug 21→24 (today +$4,414.20; Aug 21–23
// ≈ +$183 at the 29-day pre-today pace of ~$61/day, from 30d realized P/L $6,182).
const DEFAULT_START_BANKROLL = 5280;
const KEY = "ops-100k-goal-v3";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

type Cfg = { startDate: string; startBankroll: number };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function OpsGoalMeter({ balance }: { balance: number | null | undefined }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Cfg;
        if (p?.startDate && Number.isFinite(p.startBankroll)) {
          setCfg(p);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setCfg({ startDate: DEFAULT_START_DATE, startBankroll: DEFAULT_START_BANKROLL });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (next: Cfg) => {
    setCfg(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const m = useMemo(() => {
    if (!cfg || balance == null || !Number.isFinite(balance)) return null;
    const start = Math.max(1, cfg.startBankroll);
    const startMs = new Date(`${cfg.startDate}T00:00:00Z`).getTime();
    const elapsedDays = Math.max(
      0,
      Math.floor((Date.now() - startMs) / 86_400_000),
    );
    const daysLeft = Math.max(0, HORIZON_DAYS - elapsedDays);
    const targetDate = new Date(startMs + HORIZON_DAYS * 86_400_000);

    // Log-scale progress: compounding from start -> GOAL
    const progress = Math.min(
      1,
      Math.max(0, Math.log(Math.max(balance, 1) / start) / Math.log(GOAL / start)),
    );

    const actualRate = elapsedDays > 0 ? Math.pow(balance / start, 1 / elapsedDays) - 1 : 0;
    const requiredRate = daysLeft > 0 ? Math.pow(GOAL / Math.max(balance, 1), 1 / daysLeft) - 1 : Infinity;

    // Pace: where should we be today on the planned curve?
    const planNow = start * Math.pow(GOAL / start, Math.min(elapsedDays, HORIZON_DAYS) / HORIZON_DAYS);
    const aheadBy = balance - planNow;

    const etaDays =
      actualRate > 0 && balance < GOAL
        ? Math.ceil(Math.log(GOAL / balance) / Math.log(1 + actualRate))
        : null;

    return { start, elapsedDays, daysLeft, targetDate, progress, actualRate, requiredRate, planNow, aheadBy, etaDays };
  }, [cfg, balance]);

  if (!cfg) return null;

  return (
    <div className="border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="terminal-label flex items-center gap-2">
          <Flag className="h-3.5 w-3.5" />
          // $100k goal — {HORIZON_DAYS} day run
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <label className="flex items-center gap-1">
            Start
            <input
              type="date"
              value={cfg.startDate}
              onChange={(e) => save({ ...cfg, startDate: e.target.value })}
              className="bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
            />
          </label>
          <label className="flex items-center gap-1">
            From $
            <input
              type="number"
              min={1}
              value={cfg.startBankroll}
              onChange={(e) => save({ ...cfg, startBankroll: Number(e.target.value) || 1 })}
              className="w-24 bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
            />
          </label>
        </div>
      </div>

      {!m ? (
        <div className="text-xs text-muted-foreground">Waiting on live cash balance…</div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-muted-foreground">{usd(m.start)}</span>
              <span className="font-bold text-[color:var(--color-primary)]">
                {usd(balance)} · {(m.progress * 100).toFixed(1)}%
              </span>
              <span className="text-muted-foreground">{usd(GOAL)}</span>
            </div>
            <div className="relative h-3 rounded bg-muted overflow-hidden border border-border">
              <div
                className="absolute inset-y-0 left-0 bg-[color:var(--color-primary)]"
                style={{ width: `${m.progress * 100}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-foreground/70"
                style={{ left: `${Math.min(100, (m.elapsedDays / HORIZON_DAYS) * 100)}%` }}
                title="Where the plan says you should be today"
              />
            </div>
            <div className="text-[10px] text-muted-foreground">
              Marker = plan pace ({usd(m.planNow)} by day {m.elapsedDays}).{" "}
              <span className={m.aheadBy >= 0 ? "text-emerald-400" : "text-red-400"}>
                {m.aheadBy >= 0 ? "Ahead" : "Behind"} by {usd(Math.abs(m.aheadBy))}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Cell label="Day" value={`${Math.min(m.elapsedDays, HORIZON_DAYS)} / ${HORIZON_DAYS}`} />
            <Cell label="Days left" value={String(m.daysLeft)} />
            <Cell label="Remaining to goal" value={usd(GOAL - (balance ?? 0))} />
            <Cell label="Target date" value={m.targetDate.toISOString().slice(0, 10)} />
            <Cell
              label="Required rate / day"
              value={Number.isFinite(m.requiredRate) ? `${(m.requiredRate * 100).toFixed(2)}%` : "—"}
              tone={m.requiredRate > 0.06 ? "text-red-400" : m.requiredRate > 0.035 ? "text-orange-400" : "text-emerald-400"}
            />
            <Cell
              label="Actual rate / day"
              value={m.elapsedDays > 0 ? `${(m.actualRate * 100).toFixed(2)}%` : "—"}
              tone={m.actualRate >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <Cell
              label="Required $ / day"
              value={m.daysLeft > 0 ? usd(((balance ?? 0) * m.requiredRate)) : "—"}
            />
            <Cell
              label="ETA at current pace"
              value={m.etaDays == null ? (balance ?? 0) >= GOAL ? "Goal hit" : "—" : `${m.etaDays}d`}
              tone={m.etaDays != null && m.etaDays <= m.daysLeft ? "text-emerald-400" : "text-orange-400"}
            />
          </div>
        </>
      )}
    </div>
  );
}
