import { useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const GOAL = 100_000;
const DEFAULT_START_DATE = "2026-09-12";
// Current run restart: user confirmed the 100-day run restarts from $1,883
// (Kalshi cash balance, mid-Sep 2026).
const DEFAULT_START_BANKROLL = 1883;
const DEFAULT_DAILY_GOAL = 1000;
// Key stays v4 so the user's saved start date/bankroll carry over.
const KEY = "ops-100k-goal-v4";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const dateISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Cfg = { startDate: string; startBankroll: number; dailyGoal?: number };

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
    setCfg({ startDate: DEFAULT_START_DATE, startBankroll: DEFAULT_START_BANKROLL, dailyGoal: DEFAULT_DAILY_GOAL });
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
    const dailyGoal = Math.max(1, cfg.dailyGoal ?? DEFAULT_DAILY_GOAL);
    const startMs = new Date(`${cfg.startDate}T00:00:00Z`).getTime();
    const now = Date.now();
    const elapsedDays = Math.max(0, Math.floor((now - startMs) / 86_400_000));
    const remaining = Math.max(0, GOAL - balance);

    // Log-scale progress for the bar: compounding from start -> GOAL.
    const progress = Math.min(
      1,
      Math.max(0, Math.log(Math.max(balance, 1) / start) / Math.log(GOAL / start)),
    );

    // ---- Flat $1k/day plan with banked excess ----
    // Plan says: by the START of run-day k you should have start + dailyGoal*(k-1).
    // "Banked" = how far ahead of (or behind) that plan you are right now.
    // Ahead by $154  ->  today's goal is $1,000 - $154 = $846.
    // Behind by $200 ->  today's goal is $1,000 + $200 (shortfall due today, not averaged away).
    const plannedNow = start + dailyGoal * elapsedDays; // plan for start of today
    const banked = balance - plannedNow;
    const todayTarget = Math.min(GOAL - balance, Math.max(0, dailyGoal - banked));
    const todayEodGoal = balance + todayTarget;

    // Projected $100k date at the flat daily goal (averaged: remaining / dailyGoal).
    const daysNeeded = remaining / dailyGoal;
    const projectedMs = now + Math.ceil(daysNeeded) * 86_400_000;
    // Fixed 100-day deadline from the start date.
    const deadlineMs = startMs + HORIZON_DAYS_TOTAL * 86_400_000;
    const daysLeftDeadline = Math.max(0, (deadlineMs - now) / 86_400_000);
    const onDeadlinePace = projectedMs <= deadlineMs;

    // Next 3 days: each row assumes you hit exactly that day's target;
    // any excess banked today shrinks tomorrow's target dollar-for-dollar.
    const dailyPlan = [0, 1, 2].map((offset) => {
      const date = dateISO(now + offset * 86_400_000);
      const target = offset === 0 ? todayTarget : Math.min(dailyGoal, Math.max(0, GOAL - (balance + todayTarget + dailyGoal * (offset - 1))));
      const eod = Math.min(GOAL, balance + todayTarget + dailyGoal * offset);
      return { date, target, eod, label: offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "Day 3" };
    });

    return {
      start, dailyGoal, elapsedDays, remaining, progress,
      plannedNow, banked, todayTarget, todayEodGoal,
      projectedMs, deadlineMs, daysLeftDeadline, onDeadlinePace,
      dailyPlan,
    };
  }, [cfg, balance]);

  if (!cfg) return null;

  return (
    <div className="border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="terminal-label flex items-center gap-2">
          <Flag className="h-3.5 w-3.5" />
          // $100k goal — flat daily plan
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
              className="w-20 bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
            />
          </label>
          <label className="flex items-center gap-1">
            Goal $/day
            <input
              type="number"
              min={1}
              value={cfg.dailyGoal ?? DEFAULT_DAILY_GOAL}
              onChange={(e) => save({ ...cfg, dailyGoal: Number(e.target.value) || DEFAULT_DAILY_GOAL })}
              className="w-20 bg-transparent border border-border rounded px-1 py-0.5 text-foreground"
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
            </div>
          </div>

          {(balance ?? 0) < GOAL && (
            <div className="border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/5 rounded p-3 space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Today's win target · {m.dailyPlan[0]?.date}
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-[color:var(--color-primary)]">
                    +{usd(Math.ceil(m.todayTarget))}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {m.banked >= 0 ? (
                      <>
                        You're <span className="text-emerald-400 font-bold">+{usd(m.banked)} ahead</span> of
                        the day {m.elapsedDays} plan — so today is {usd(m.dailyGoal)} − {usd(m.banked)}. End
                        today at {usd(m.todayEodGoal)}, then stop.
                      </>
                    ) : (
                      <>
                        You're <span className="text-red-400 font-bold">{usd(m.banked)} behind</span> the
                        day {m.elapsedDays} plan — today is {usd(m.dailyGoal)} + {usd(Math.abs(m.banked))} shortfall.
                        End today at {usd(m.todayEodGoal)}.
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Projected $100k date
                  </div>
                  <div className={cn("text-lg font-bold tabular-nums", m.onDeadlinePace ? "text-emerald-400" : "text-orange-400")}>
                    {dateISO(m.projectedMs)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    deadline {dateISO(m.deadlineMs)} · {m.daysLeftDeadline.toFixed(0)}d left
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground border-t border-border/60 pt-1.5">
                The rule: flat {usd(m.dailyGoal)}/day. Win extra and it banks — tomorrow's target
                drops by exactly that much. Miss and the shortfall lands on tomorrow, and the
                projected date pushes out. Hit the number, then stop. No chasing.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Cell label="Run day" value={`${m.elapsedDays + 1}`} />
            <Cell label="Remaining to goal" value={usd(m.remaining)} />
            <Cell
              label="Banked vs plan"
              value={`${m.banked >= 0 ? "+" : "−"}${usd(Math.abs(m.banked))}`}
              tone={m.banked >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <Cell
              label="Projected $100k"
              value={dateISO(m.projectedMs)}
              tone={m.onDeadlinePace ? "text-emerald-400" : "text-orange-400"}
            />
          </div>

          <div className="border border-border rounded p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Next 3 days — excess banks into the next day
            </div>
            <div className="grid grid-cols-3 gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>Day</span>
              <span className="text-right">Win target</span>
              <span className="text-right">End-of-day balance</span>
            </div>
            {m.dailyPlan.map((d, i) => (
              <div
                key={d.date}
                className={cn(
                  "grid grid-cols-3 gap-1 text-xs tabular-nums border-t border-border/60 pt-1",
                  i === 0 && "text-[color:var(--color-primary)]",
                )}
              >
                <span>{d.label} · {d.date}</span>
                <span className="text-right font-bold">+{usd(Math.ceil(d.target))}</span>
                <span className="text-right font-bold">{usd(d.eod)}</span>
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground">
              Example: end today $154 over target and tomorrow's row drops from {usd(m.dailyGoal)} to{" "}
              {usd(Math.max(0, m.dailyGoal - 154))} automatically.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const HORIZON_DAYS_TOTAL = 100;
