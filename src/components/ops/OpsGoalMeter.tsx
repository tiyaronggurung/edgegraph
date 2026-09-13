import { useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const GOAL = 100_000;
const HORIZON_DAYS = 100;
const DEFAULT_START_DATE = "2026-09-12";
// Current run restart: user confirmed the 100-day run restarts from $1,883
// (Kalshi cash balance, mid-Sep 2026).
const DEFAULT_START_BANKROLL = 1883;
// v4: restart of the run at $1,883 (mid-Sep 2026); fresh key applies new defaults.
const KEY = "ops-100k-goal-v4";

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
  const [savedFlash, setSavedFlash] = useState(false);

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
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
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

    const requiredRate = daysLeft > 0 ? Math.pow(GOAL / Math.max(balance, 1), 1 / daysLeft) - 1 : Infinity;
    // Exact average dollars needed per remaining day to hit the goal.
    const requiredPerDay = daysLeft > 0 ? Math.max(0, GOAL - balance) / daysLeft : null;
    // Exact elapsed fraction of a day for precise "days left" display.
    const elapsedExact = Math.max(0, (Date.now() - startMs) / 86_400_000);
    const daysLeftExact = Math.max(0, HORIZON_DAYS - elapsedExact);
    // Actual rate is meaningless before ~2 days of data (one good hour skews it).
    const reliableRate = elapsedExact >= 2;
    const actualRate = reliableRate ? Math.pow(balance / start, 1 / elapsedExact) - 1 : null;

    // Rolling 5-day target: where the required-rate curve says we must be in 5 days.
    const fiveDayTarget = Number.isFinite(requiredRate)
      ? balance * Math.pow(1 + requiredRate, Math.min(5, daysLeftExact))
      : null;

    // Per-day goals:
    // 1) Catch-up target: balance needed tomorrow if we compound at requiredRate.
    const tomorrowRequired = Number.isFinite(requiredRate) ? balance * (1 + requiredRate) : null;
    // 2) Plan target: where the original 100-day curve says we should be tomorrow.
    const tomorrowPlan =
      start * Math.pow(GOAL / start, Math.min(elapsedDays + 1, HORIZON_DAYS) / HORIZON_DAYS);

    // Pace: where should we be today on the planned curve?
    const planNow = start * Math.pow(GOAL / start, Math.min(elapsedDays, HORIZON_DAYS) / HORIZON_DAYS);
    const aheadBy = balance - planNow;

    // Discipline metrics:
    // 1) How many plan-days your current balance already covers.
    //    > 0 means you're ahead of the curve; < 0 means behind.
    const daysAhead = (Math.log(Math.max(balance, 1) / start) / Math.log(GOAL / start)) * HORIZON_DAYS - elapsedDays;
    // 2) Excess = how far above TOMORROW's required balance you already are.
    //    If positive, today's job is done — anything more is greed, not goal.
    const excess =
      tomorrowRequired != null ? balance - tomorrowRequired : null;

    const etaDays =
      actualRate != null && actualRate > 0 && balance < GOAL
        ? Math.ceil(Math.log(GOAL / balance) / Math.log(1 + actualRate))
        : null;

    return { start, elapsedDays, daysLeft, daysLeftExact, targetDate, progress, actualRate, requiredRate, requiredPerDay, planNow, aheadBy, etaDays, tomorrowRequired, tomorrowPlan, daysAhead, excess, fiveDayTarget };
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
          {savedFlash && <span className="text-emerald-400">Saved ✓</span>}
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

          {m.tomorrowRequired != null && (balance ?? 0) < GOAL && (
            <div className="border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/5 rounded p-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Tomorrow's goal balance
                </div>
                <div className="text-lg font-bold tabular-nums text-[color:var(--color-primary)]">
                  {usd(m.tomorrowRequired)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  on plan pace: {usd(m.tomorrowPlan)}
                </div>
              </div>
              {m.excess != null && m.excess > 0 ? (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-emerald-400">
                    Goal already covered — excess
                  </div>
                  <div className="text-lg font-bold tabular-nums text-emerald-400">
                    +{usd(m.excess)}
                  </div>
                  <div className="text-[10px] text-emerald-400">
                    {m.daysAhead >= 1
                      ? `${m.daysAhead.toFixed(1)} days ahead of plan — bank it, stop for today`
                      : "Ahead of tomorrow — bank it, no chasing"}
                  </div>
                </div>
              ) : (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Win needed by tomorrow
                  </div>
                  <div className="text-lg font-bold tabular-nums text-emerald-400">
                    +{usd(Math.max(0, m.tomorrowRequired - (balance ?? 0)))}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {m.daysAhead >= 0
                      ? `${m.daysAhead.toFixed(1)} days ahead of plan — hit this and stop`
                      : `${Math.abs(m.daysAhead).toFixed(1)} days behind plan — hit this, no overbetting`}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Cell label="Day" value={`${Math.min(m.elapsedDays, HORIZON_DAYS)} / ${HORIZON_DAYS}`} />
            <Cell label="Days left" value={m.daysLeftExact.toFixed(1)} />
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
              value={
                m.requiredPerDay != null
                  ? `$${m.requiredPerDay.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : "—"
              }
            />
            <Cell
              label="ETA at current pace"
              value={m.etaDays == null ? (balance ?? 0) >= GOAL ? "Goal hit" : "—" : `${m.etaDays}d`}
              tone={m.etaDays != null && m.etaDays <= m.daysLeft ? "text-emerald-400" : "text-orange-400"}
            />
            <Cell
              label="Days ahead of plan"
              value={`${m.daysAhead >= 0 ? "+" : "−"}${Math.abs(m.daysAhead).toFixed(1)}`}
              tone={m.daysAhead >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <Cell
              label="Excess above tomorrow"
              value={m.excess != null && m.excess > 0 ? `+${usd(m.excess)}` : "—"}
              tone={m.excess != null && m.excess > 0 ? "text-emerald-400" : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}
