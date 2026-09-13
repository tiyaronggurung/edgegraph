import { useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const GOAL = 100_000;
const HORIZON_DAYS = 100;
const DEFAULT_START_DATE = "2026-09-12";
// Current run restart: user confirmed the 100-day run restarts from $1,883
// (Kalshi cash balance, mid-Sep 2026).
const DEFAULT_START_BANKROLL = 1883;
// v5: flat-quota planner — fixed goal date, daily $ quota = remaining / days left.
const KEY = "ops-100k-goal-v5";

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const dateISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Cfg = { startDate: string; startBankroll: number };

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
    const now = Date.now();
    const elapsedExact = Math.max(0, (now - startMs) / 86_400_000);
    const elapsedDays = Math.floor(elapsedExact);
    const daysLeftExact = Math.max(0, HORIZON_DAYS - elapsedExact);
    const daysLeft = Math.max(1, Math.ceil(daysLeftExact));
    const goalDateMs = startMs + HORIZON_DAYS * 86_400_000;

    // Log-scale progress: compounding from start -> GOAL
    const progress = Math.min(
      1,
      Math.max(0, Math.log(Math.max(balance, 1) / start) / Math.log(GOAL / start)),
    );

    // ---- Flat-quota discipline plan ----
    // THE number: average $/day needed from TODAY to hit GOAL by the fixed date.
    // Win more than this today -> tomorrow's quota drops. Miss it -> quota rises.
    // The goal date never moves in the math; only the daily workload does.
    const remaining = Math.max(0, GOAL - balance);
    const dailyQuota = remaining / daysLeft;

    // Pace check vs the original plan curve (only used for the marker/ahead readout).
    const planNow = start * Math.pow(GOAL / start, Math.min(elapsedDays, HORIZON_DAYS) / HORIZON_DAYS);
    const aheadBy = balance - planNow;
    const daysAhead =
      (Math.log(Math.max(balance, 1) / start) / Math.log(GOAL / start)) * HORIZON_DAYS - elapsedDays;

    // Actual growth rate — unreliable before ~2 days of data.
    const reliableRate = elapsedExact >= 2;
    const actualRate = reliableRate ? Math.pow(balance / start, 1 / elapsedExact) - 1 : null;
    const etaDays =
      actualRate != null && actualRate > 0 && balance < GOAL
        ? Math.ceil(Math.log(GOAL / balance) / Math.log(1 + actualRate))
        : null;
    const etaDateMs = etaDays != null ? now + etaDays * 86_400_000 : null;

    // Dated day-by-day plan: flat quota steps from the CURRENT balance.
    // Excess carries forward automatically because this recomputes off live balance.
    const dailyPlan = [0, 1, 2].map((offset) => {
      const date = dateISO(now + offset * 86_400_000);
      const eodGoal = Math.min(GOAL, balance + dailyQuota * (offset + 1));
      return { date, eodGoal, quota: dailyQuota, label: offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "Day 3" };
    });

    return {
      start, elapsedDays, daysLeft, daysLeftExact, goalDateMs, progress,
      remaining, dailyQuota, planNow, aheadBy, daysAhead,
      actualRate, etaDays, etaDateMs, dailyPlan,
    };
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

          {(balance ?? 0) < GOAL && (
            <div className="border border-[color:var(--color-primary)]/50 bg-[color:var(--color-primary)]/5 rounded p-3 space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Today's win target · {m.dailyPlan[0]?.date}
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-[color:var(--color-primary)]">
                    +{usd(Math.ceil(m.dailyQuota))}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    End today at {usd(m.dailyPlan[0]?.eodGoal)} — hit it and stop.
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Goal date (fixed)
                  </div>
                  <div className="text-lg font-bold tabular-nums">{dateISO(m.goalDateMs)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {m.daysLeft} days left · {usd(m.remaining)} to go
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground border-t border-border/60 pt-1.5">
                How this works: the quota = what's left ÷ days left. Beat it and tomorrow's quota
                drops dollar-for-dollar. Miss it and the shortfall is spread over the remaining
                days — the goal date stays fixed, the workload moves. No chasing, no overbetting.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Cell label="Day" value={`${Math.min(m.elapsedDays, HORIZON_DAYS)} / ${HORIZON_DAYS}`} />
            <Cell label="Days left" value={m.daysLeftExact.toFixed(1)} />
            <Cell label="Remaining to goal" value={usd(m.remaining)} />
            <Cell
              label="Required $ / day"
              value={`$${m.dailyQuota.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              tone="text-[color:var(--color-primary)]"
            />
            <Cell
              label="Actual rate / day"
              value={m.actualRate != null ? `${(m.actualRate * 100).toFixed(2)}%` : "—"}
              tone={m.actualRate != null && m.actualRate >= 0 ? "text-emerald-400" : m.actualRate != null ? "text-red-400" : undefined}
            />
            <Cell
              label="ETA at current pace"
              value={
                (balance ?? 0) >= GOAL
                  ? "Goal hit"
                  : m.etaDays == null
                    ? "—"
                    : `${m.etaDays}d · ${dateISO(m.etaDateMs!)}`
              }
              tone={m.etaDays != null && m.etaDays <= m.daysLeft ? "text-emerald-400" : "text-orange-400"}
            />
            <Cell
              label="Days ahead of plan"
              value={`${m.daysAhead >= 0 ? "+" : "−"}${Math.abs(m.daysAhead).toFixed(1)}`}
              tone={m.daysAhead >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <Cell label="Target date" value={dateISO(m.goalDateMs)} />
          </div>

          <div className="border border-border rounded p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Next 3 days — flat quota, excess carries forward
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
                <span className="text-right font-bold">+{usd(Math.ceil(d.quota))}</span>
                <span className="text-right font-bold">{usd(d.eodGoal)}</span>
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground">
              Beat today's target and every future row recomputes lower off the higher balance.
              Fall short and the quota rises tomorrow. Discipline = hit the number, then stop.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
