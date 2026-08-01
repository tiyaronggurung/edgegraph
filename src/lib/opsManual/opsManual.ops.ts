// Server-only orchestration for the Operating Manual (DB reads/writes).
// Named `.ops.ts` (not `.server.ts`) only so the pure computation helpers in
// opsManual.server.ts stay separate; this file is imported dynamically from
// inside server-function handlers, never at module scope of a route.
import {
  OPS_RULES,
  computeStakingMode,
  computeStatus,
  evaluateDailyStops,
  evaluateQualification,
  disciplineScore,
  nextMilestone,
  rollingWinRate,
  round2,
  WITHDRAWAL_MILESTONES,
  type StakingMode,
} from "./rules";
import { runOpsBacktest, summarizeLedger, type LedgerTrade } from "./opsManual.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function assertAdmin(supabase: SB, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("is_ops_admin", { _user_id: userId });
  if (error) throw new Error(`admin check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const SEED_BANKROLL = 1000;

export async function loadOpsDashboard(supabase: SB, userId: string) {
  await assertAdmin(supabase, userId);
  const session_date = todayUtc();

  const [tradesRes, snapRes, alertsRes, wdRes, modeRes, thrRes, btRes, violRes] = await Promise.all([
    supabase.from("ops_trades").select("*").eq("user_id", userId).order("decision_at", { ascending: false }).limit(1000),
    supabase.from("ops_daily_snapshots").select("*").eq("user_id", userId).eq("session_date", session_date).maybeSingle(),
    supabase.from("ops_alerts").select("*").eq("user_id", userId).order("triggered_at", { ascending: false }).limit(100),
    supabase.from("ops_withdrawals").select("*").eq("user_id", userId).order("milestone_to", { ascending: true }),
    supabase.from("ops_mode_changes").select("*").eq("user_id", userId).order("changed_at", { ascending: false }).limit(50),
    supabase.from("ops_threshold_changes").select("*").order("changed_at", { ascending: false }).limit(50),
    supabase.from("ops_backtest_runs").select("*").order("run_at", { ascending: false }).limit(1),
    supabase.from("ops_rule_violations").select("*").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(100),
  ]);

  const trades = (tradesRes.data ?? []) as LedgerTrade[];
  const withdrawals = (wdRes.data ?? []) as Array<{ milestone_from: number; milestone_to: number; required_amount: number; withdrawn_amount: number; status: string }>;
  const withdrawn = withdrawals.reduce((s, w) => s + Number(w.withdrawn_amount || 0), 0);

  const summary = summarizeLedger(trades, SEED_BANKROLL, withdrawn);

  const violations = (violRes.data ?? []) as Array<{ occurred_at: string; rule_code: string; description: string | null; session_date: string }>;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weeklyViolations = violations.filter((v) => Date.parse(v.occurred_at) >= weekAgo).length;

  const status = computeStatus({
    rolling30Wr: summary.rolling30Wr,
    rolling100Wr: summary.rolling100Wr,
    drawdownPct: summary.drawdownPct / 100,
    settled100: summary.totalWins + summary.totalLosses,
  });

  const snapshot = snapRes.data as null | {
    morning_bankroll: number; unit_pct: number; unit_usd: number; staking_mode: string;
    mode_reason: string | null; bets_placed: number; consecutive_losses: number; daily_pnl: number;
    stopped: boolean; stop_reason: string | null;
  };

  const morningBankroll = snapshot ? Number(snapshot.morning_bankroll) : summary.currentBankroll - withdrawn;

  const staking = computeStakingMode({
    morningBankroll,
    status: status.status,
    weeklyViolations,
    betsSettledSinceRiskReduced: 0,
  });

  const todayTrades = trades.filter((t) => t.session_date === session_date);
  const todaySettled = todayTrades
    .filter((t) => t.result === "win" || t.result === "loss")
    .sort((a, b) => Date.parse(a.decision_at) - Date.parse(b.decision_at));
  let consec = 0;
  for (let i = todaySettled.length - 1; i >= 0; i--) {
    if (todaySettled[i].result === "loss") consec++;
    else break;
  }
  const dailyPnl = round2(todaySettled.reduce((s, t) => s + (t.realized_pnl ?? 0), 0));
  const isSunday = new Date().getUTCDay() === 0;

  const stops = evaluateDailyStops({
    betsPlaced: todayTrades.length,
    consecutiveLosses: consec,
    dailyPnl,
    morningBankroll,
    ruleViolationToday: violations.some((v) => v.session_date === session_date),
    isSunday,
  });

  const milestone = nextMilestone(summary.currentBankroll);

  return {
    ok: true as const,
    sessionDate: session_date,
    seedBankroll: SEED_BANKROLL,
    summary,
    status,
    staking: staking.mode === "disabled" ? staking : { ...staking, unitUsd: round2(morningBankroll * staking.unitPct) },
    morningBankroll: round2(morningBankroll),
    dayOpened: !!snapshot,
    stops,
    consecutiveLosses: consec,
    dailyPnl,
    isSunday,
    weeklyViolations,
    trades,
    alerts: alertsRes.data ?? [],
    violations,
    withdrawals,
    withdrawnTotal: round2(withdrawn),
    milestones: WITHDRAWAL_MILESTONES,
    nextMilestone: milestone,
    modeChanges: modeRes.data ?? [],
    thresholdChanges: thrRes.data ?? [],
    lastBacktest: (btRes.data ?? [])[0] ?? null,
    rules: OPS_RULES,
  };
}

export async function runAndStoreBacktest(supabase: SB, userId: string) {
  await assertAdmin(supabase, userId);
  const out = await runOpsBacktest(supabase);
  const { error } = await supabase.from("ops_backtest_runs").insert({
    user_id: userId,
    through_date: todayUtc(),
    status: out.status,
    rolling30_wr: out.rolling30Wr,
    rolling100_wr: out.rolling100Wr,
    max_drawdown_pct: out.maxDrawdownPct,
    results: out as unknown as Record<string, unknown>,
  });
  if (error) return { ok: false as const, error: error.message, backtest: out };
  return { ok: true as const, backtest: out };
}

export async function openTradingDay(supabase: SB, userId: string, morningBankroll: number) {
  await assertAdmin(supabase, userId);
  const dash = await loadOpsDashboard(supabase, userId);
  const staking = computeStakingMode({
    morningBankroll,
    status: dash.status.status,
    weeklyViolations: dash.weeklyViolations,
  });
  const { error } = await supabase.from("ops_daily_snapshots").upsert(
    {
      user_id: userId,
      session_date: todayUtc(),
      morning_bankroll: morningBankroll,
      all_time_high_bankroll: dash.summary.allTimeHigh,
      unit_pct: staking.unitPct,
      unit_usd: staking.unitUsd,
      staking_mode: staking.mode,
      mode_reason: staking.reason,
      review_only: new Date().getUTCDay() === 0,
    },
    { onConflict: "user_id,session_date" },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, staking };
}

export interface LogTradeInput {
  ticker: string;
  strike?: number | null;
  side?: string | null;
  studySide?: string | null;
  studyConf?: number | null;
  modelSide?: string | null;
  modelConf?: number | null;
  spotAtLock?: number | null;
  cushionUsd?: number | null;
  askCents?: number | null;
  secondsLeft?: number | null;
  stake: number;
  notes?: string | null;
  overrideViolations?: string[];
}

export async function logOpsTrade(supabase: SB, userId: string, input: LogTradeInput) {
  await assertAdmin(supabase, userId);
  const dash = await loadOpsDashboard(supabase, userId);
  const utcHour = new Date().getUTCHours();

  const q = evaluateQualification({
    hasT7Lock: !!input.studySide,
    studyConfPct: input.studyConf ?? null,
    cushionUsd: input.cushionUsd ?? null,
    askCents: input.askCents ?? null,
    modelSide: input.modelSide ?? null,
    studySide: input.studySide ?? null,
    secondsLeft: input.secondsLeft ?? null,
    utcHour,
  });

  const violations = [...q.failReasons, ...(input.overrideViolations ?? [])];
  if (dash.stops.stopped) violations.push("daily_stop");
  if (dash.stops.betsRemaining <= 0) violations.push("daily_limit");
  if (dash.staking.mode !== "disabled" && Math.abs(input.stake - dash.staking.unitUsd) > 0.51) {
    violations.push("staking");
  }
  const unique = [...new Set(violations)];

  const askCents = input.askCents ?? null;
  const potential =
    askCents != null && askCents > 0 ? round2(input.stake * ((100 - askCents) / askCents)) : null;

  const { data, error } = await supabase
    .from("ops_trades")
    .insert({
      user_id: userId,
      session_date: todayUtc(),
      ticker: input.ticker,
      utc_hour: utcHour,
      strike: input.strike ?? null,
      side: input.side ?? input.studySide ?? null,
      study_side: input.studySide ?? null,
      study_conf: input.studyConf ?? null,
      model_side: input.modelSide ?? null,
      model_conf: input.modelConf ?? null,
      spot_at_lock: input.spotAtLock ?? null,
      cushion_usd: input.cushionUsd ?? null,
      ask_cents: askCents,
      seconds_left: input.secondsLeft ?? null,
      stake: input.stake,
      potential_profit: potential,
      rule_status: unique.length === 0 ? "compliant" : "violation",
      violations: unique,
      discipline_score: disciplineScore(unique),
      notes: input.notes ?? null,
      // Immutable snapshot of exactly what was known at the decision timestamp.
      decision_snapshot: {
        capturedAt: new Date().toISOString(),
        filters: q.filters,
        qualified: q.qualified,
        preferredHour: q.preferredHour,
        stakingMode: dash.staking.mode,
        unitUsd: dash.staking.unitUsd,
        morningBankroll: dash.morningBankroll,
        input,
      },
    })
    .select("id")
    .single();
  if (error) return { ok: false as const, error: error.message };

  for (const code of unique) {
    await supabase.from("ops_rule_violations").insert({
      user_id: userId,
      session_date: todayUtc(),
      rule_code: code,
      description: `Trade logged on ${input.ticker} violated: ${code}`,
      trade_id: data.id,
    });
  }

  return { ok: true as const, id: data.id, qualified: q.qualified, violations: unique };
}

export async function settleOpsTrade(
  supabase: SB,
  userId: string,
  input: { id: string; result: "win" | "loss" | "void"; realizedPnl: number },
) {
  await assertAdmin(supabase, userId);
  const { data: existing, error: readErr } = await supabase
    .from("ops_trades")
    .select("id, result")
    .eq("id", input.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) return { ok: false as const, error: readErr.message };
  if (!existing) return { ok: false as const, error: "Trade not found" };
  if (existing.result) return { ok: false as const, error: "Trade already settled — history is immutable" };

  const dash = await loadOpsDashboard(supabase, userId);
  const bankrollAfter = round2(dash.summary.currentBankroll + input.realizedPnl);

  const { error } = await supabase
    .from("ops_trades")
    .update({
      result: input.result,
      realized_pnl: round2(input.realizedPnl),
      bankroll_after: bankrollAfter,
    })
    .eq("id", input.id)
    .eq("user_id", userId);
  if (error) return { ok: false as const, error: error.message };

  await maybeRaiseAlerts(supabase, userId);
  return { ok: true as const, bankrollAfter };
}

async function maybeRaiseAlerts(supabase: SB, userId: string) {
  const dash = await loadOpsDashboard(supabase, userId);
  const level =
    dash.status.status === "kill_switch"
      ? "red"
      : dash.status.status === "risk_reduced"
        ? "orange"
        : dash.status.status === "watch"
          ? "yellow"
          : "green";
  if (level === "green") return;

  const { data: open } = await supabase
    .from("ops_alerts")
    .select("id")
    .eq("user_id", userId)
    .eq("code", dash.status.metric)
    .is("resolved_at", null)
    .limit(1);
  if (open && open.length > 0) return;

  await supabase.from("ops_alerts").insert({
    user_id: userId,
    level,
    code: dash.status.metric,
    metric: dash.status.metric,
    current_value: dash.status.currentValue,
    threshold_value: dash.status.thresholdValue,
    action_taken:
      level === "red"
        ? "New trades disabled"
        : level === "orange"
          ? "Unit reduced to 6% of morning bankroll"
          : "Watch level — no automatic action",
    resume_conditions:
      level === "red"
        ? "Resolve the underlying condition, then pass a fresh validation check"
        : "30 additional settled qualifying bets restoring the rolling win rate",
    manual_review_required: level === "red",
    details: { reason: dash.status.reason },
  });
}

export async function acknowledgeAlert(supabase: SB, userId: string, id: string) {
  await assertAdmin(supabase, userId);
  // Acknowledging never restores trading — resolved_at stays untouched.
  const { error } = await supabase
    .from("ops_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function recordWithdrawal(
  supabase: SB,
  userId: string,
  milestoneTo: number,
  amount: number,
) {
  await assertAdmin(supabase, userId);
  const m = WITHDRAWAL_MILESTONES.find((x) => x.to === milestoneTo);
  if (!m) return { ok: false as const, error: "Unknown milestone" };
  const { error } = await supabase.from("ops_withdrawals").upsert(
    {
      user_id: userId,
      milestone_from: m.from,
      milestone_to: m.to,
      required_amount: m.required,
      withdrawn_amount: round2(amount),
      status: amount >= m.required ? "complete" : "pending",
      completed_at: amount >= m.required ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,milestone_to" },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function recordThresholdChange(
  supabase: SB,
  userId: string,
  input: { key: string; previousValue: string | null; newValue: string; reason: string },
) {
  await assertAdmin(supabase, userId);
  const { error } = await supabase.from("ops_threshold_changes").insert({
    user_id: userId,
    threshold_key: input.key,
    previous_value: input.previousValue,
    new_value: input.newValue,
    actor: userId,
    reason: input.reason,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function recordModeChange(
  supabase: SB,
  userId: string,
  from: StakingMode | null,
  to: StakingMode,
  reason: string,
) {
  await supabase.from("ops_mode_changes").insert({
    user_id: userId,
    from_mode: from,
    to_mode: to,
    reason,
    actor: "system",
  });
}

export { rollingWinRate };
