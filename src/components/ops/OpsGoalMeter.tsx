import { useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const GOAL = 100_000;
const HORIZON_DAYS = 100;
const DEFAULT_START_DATE = "2026-09-12";
// Current run restart: user confirmed the 100-day run restarts from $1,883
// (Kalshi cash balance, mid-Sep 2026).
const DEFAULT_START_BANKROLL = 1883;
const DEFAULT_DAILY_GOAL = 1000;
// Key stays v4 so the user's saved start date/bankroll carry over.
const KEY = "ops-100k-goal-v4";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;


const dateISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const todayISO = () => dateISO(Date.now());
const dateLabel = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(ms));

type Cfg = {
  startDate: string;
  startBankroll: number;
  dailyGoal?: number;
  // Day-anchor bookkeeping for the flat daily goal:
  // anchor = balance at the first load of the current day.
  anchorDate?: string;
  anchorBalance?: number;
  // Excess banked from yesterday (won more than the daily goal) — comes off today's target.
  carryExcess?: number;
};

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function OpsGoalMeter({
  balance,
  winRate,
  btcWinRate,
  todayPnl,
}: {
  balance: number | null | undefined;
  winRate?: number | null;
  btcWinRate?: number | null;
  todayPnl?: number | null;
}) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [hoveredMilestone, setHoveredMilestone] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => setNowMs(Date.now()), []);

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

  // Roll the day anchor: first time we see a new calendar day, bank yesterday's
  // excess over the daily goal into carryExcess and re-anchor at the live balance.
  useEffect(() => {
    if (!cfg || balance == null || !Number.isFinite(balance)) return;
    const today = todayISO();
    if (cfg.anchorDate === today) return;
    const dailyGoal = Math.max(1, cfg.dailyGoal ?? DEFAULT_DAILY_GOAL);
    const hadAnchor = cfg.anchorDate && Number.isFinite(cfg.anchorBalance);
    const yesterdayWin = hadAnchor ? balance - (cfg.anchorBalance as number) : 0;
    const carryExcess = hadAnchor ? Math.max(0, yesterdayWin - dailyGoal) : 0;
    save({ ...cfg, anchorDate: today, anchorBalance: balance, carryExcess });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, balance]);

  const m = useMemo(() => {
    if (!cfg || balance == null || !Number.isFinite(balance)) return null;
    const dailyGoal = Math.max(1, cfg.dailyGoal ?? DEFAULT_DAILY_GOAL);
    const startMs = new Date(`${cfg.startDate}T00:00:00Z`).getTime();
    const now = Date.now();
    const elapsedDays = Math.max(0, Math.floor((now - startMs) / 86_400_000));
    const remaining = Math.max(0, GOAL - balance);

    // The daily plan is based only on $1,000 balance milestones. At $4,155,
    // $155 is already banked toward day 5, so the next target is $845.
    const completedDailyGoals = Math.floor(balance / dailyGoal);
    const bankedTowardNext = balance - completedDailyGoals * dailyGoal;
    const todayTarget = bankedTowardNext > 0 ? dailyGoal - bankedTowardNext : dailyGoal;
    const todayEodGoal = balance + todayTarget;
    const linearProgress = Math.min(1, Math.max(0, balance / GOAL));
    const nextTargetMarkerPct = Math.min(1, Math.max(0, todayEodGoal / GOAL));
    const milestoneTicks = Array.from(
      { length: Math.floor(GOAL / dailyGoal) },
      (_, index) => (index + 1) * dailyGoal,
    );

    // Projected $100k date at the flat daily goal, from the live balance.
    const daysNeeded = remaining / dailyGoal;
    const projectedMs = now + Math.ceil(daysNeeded) * 86_400_000;
    const deadlineMs = startMs + HORIZON_DAYS * 86_400_000;
    const daysLeftDeadline = Math.max(0, (deadlineMs - now) / 86_400_000);
    const onDeadlinePace = projectedMs <= deadlineMs;

    // Next 3 days: today uses the adjusted target; future days assume the flat
    // goal. Any excess banked today shrinks tomorrow automatically on rollover.
    const dailyPlan = [0, 1, 2].map((offset) => {
      const date = dateISO(now + offset * 86_400_000);
      const target = offset === 0 ? todayTarget : Math.min(dailyGoal, Math.max(0, GOAL - (balance + todayTarget + dailyGoal * (offset - 1))));
      const eod = Math.min(GOAL, balance + todayTarget + dailyGoal * offset);
      return { date, target, eod, label: offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "Day 3" };
    });

    return {
      dailyGoal, elapsedDays, remaining, completedDailyGoals, bankedTowardNext,
      linearProgress, nextTargetMarkerPct, todayTarget, todayEodGoal,
      projectedMs, deadlineMs, daysLeftDeadline, onDeadlinePace,
      dailyPlan, milestoneTicks,
    };
  }, [cfg, balance]);

  if (!cfg) return null;

  const inspectedMilestone = m ? hoveredMilestone ?? m.todayEodGoal : GOAL;
  const inspectedSurpassed = balance != null && inspectedMilestone <= balance;
  const inspectedDaysAway = m
    ? Math.max(0, Math.ceil((inspectedMilestone - m.todayEodGoal) / m.dailyGoal))
    : 0;
  const inspectedDateMs = Date.now() + inspectedDaysAway * 86_400_000;

  const inspectMilestoneAt = (clientX: number, element: HTMLDivElement) => {
    if (!m) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const position = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const milestone = Math.min(
      GOAL,
      Math.max(m.dailyGoal, Math.round((position * GOAL) / m.dailyGoal) * m.dailyGoal),
    );
    setHoveredMilestone(milestone);
  };

  return (
    <div className="border border-border rounded p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="terminal-label flex items-center gap-2">
          <Flag className="h-3.5 w-3.5" />
          // $100k goal — flat daily plan
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground flex-wrap">
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
              <span className="text-muted-foreground">{usd(cfg.startBankroll)}</span>
              <span className="font-bold text-[color:var(--color-primary)]">
                {usd(balance)} · {(m.linearProgress * 100).toFixed(1)}%
              </span>
              <span className="text-muted-foreground">{usd(GOAL)}</span>
            </div>
            <div
              className="group relative h-5 cursor-crosshair overflow-hidden rounded border border-border bg-muted outline-none focus-visible:ring-1 focus-visible:ring-ring"
              role="slider"
              tabIndex={0}
              aria-label="Inspect one-thousand-dollar balance milestones"
              aria-valuemin={m.dailyGoal}
              aria-valuemax={GOAL}
              aria-valuenow={inspectedMilestone}
              onPointerMove={(event) => inspectMilestoneAt(event.clientX, event.currentTarget)}
              onPointerDown={(event) => inspectMilestoneAt(event.clientX, event.currentTarget)}
              onPointerLeave={() => setHoveredMilestone(null)}
              onFocus={() => setHoveredMilestone(m.todayEodGoal)}
              onBlur={() => setHoveredMilestone(null)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                setHoveredMilestone(
                  Math.min(GOAL, Math.max(m.dailyGoal, inspectedMilestone + direction * m.dailyGoal)),
                );
              }}
            >
              <div
                className="absolute inset-y-0 left-0 bg-[color:var(--color-primary)] transition-[width] duration-300"
                style={{ width: `${m.linearProgress * 100}%` }}
              />
              {m.milestoneTicks.map((milestone) => (
                <span
                  key={milestone}
                  className={cn(
                    "pointer-events-none absolute bottom-0 z-10 w-px bg-foreground/20",
                    milestone % 10_000 === 0 ? "h-full bg-foreground/45" : "h-1.5",
                  )}
                  style={{ left: `${(milestone / GOAL) * 100}%` }}
                />
              ))}
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-foreground shadow-[0_0_8px_var(--color-foreground)]"
                style={{ left: `${m.nextTargetMarkerPct * 100}%` }}
                title="Next $1,000 balance target"
              />
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 z-30 w-px bg-warning opacity-0 transition-opacity",
                  hoveredMilestone != null && "opacity-100",
                )}
                style={{ left: `${(inspectedMilestone / GOAL) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-4">
              <div className="bg-background p-2">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Goal balance</div>
                <div className="text-sm font-bold tabular-nums text-foreground">{usd(inspectedMilestone)}</div>
              </div>
              <div className="bg-background p-2">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {inspectedSurpassed ? "Status" : "Destination"}
                </div>
                <div className={cn("text-sm font-bold tabular-nums", inspectedSurpassed ? "text-success" : "text-primary")}>
                  {inspectedSurpassed ? "Surpassed ✓" : dateLabel(inspectedDateMs)}
                </div>
              </div>
              <div className="bg-background p-2">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {inspectedSurpassed ? "Next balance" : "Win remaining"}
                </div>
                <div className="text-sm font-bold tabular-nums text-foreground">
                  {inspectedSurpassed ? usd(m.todayEodGoal) : `+${usd(Math.max(0, inspectedMilestone - (balance ?? 0)))}`}
                </div>
              </div>
              <div className="bg-background p-2">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {inspectedSurpassed ? "Next destination" : "Time to target"}
                </div>
                <div className="text-sm font-bold tabular-nums text-foreground">
                  {inspectedSurpassed ? dateLabel(Date.now()) : inspectedDaysAway === 0 ? "Today" : `${inspectedDaysAway} day${inspectedDaysAway === 1 ? "" : "s"}`}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-muted-foreground">
              <span>Every tick = {usd(m.dailyGoal)}</span>
              <span>Next: {usd(m.todayEodGoal)} by {dateLabel(Date.now())}</span>
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
                  <div className="text-[10px] text-muted-foreground space-y-0.5">
                    <div>
                      Banked toward this {usd(m.dailyGoal)} goal:{" "}
                      <span className="text-emerald-400 font-bold">+{usd(m.bankedTowardNext)}</span>
                      {` — win ${usd(m.todayTarget)} more and stop at ${usd(m.todayEodGoal)}.`}
                    </div>
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
                The rule: flat {usd(m.dailyGoal)}/day from here. Win extra and it banks —
                tomorrow's target drops by exactly that much. Miss and the projected date
                pushes out. Hit the number, then stop. No chasing.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Cell label="Current goal day" value={`${m.completedDailyGoals + 1}`} />
            <Cell label="Remaining to goal" value={usd(m.remaining)} />
            <Cell
              label="Banked toward next $1k"
              value={`+${usd(m.bankedTowardNext)}`}
              tone="text-emerald-400"
            />
            <Cell
              label="Projected $100k"
              value={dateISO(m.projectedMs)}
              tone={m.onDeadlinePace ? "text-emerald-400" : "text-orange-400"}
            />
            <Cell label="Current win rate" value={pct(winRate)} />
            <Cell label="BTC 15m win rate" value={pct(btcWinRate)} />
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
