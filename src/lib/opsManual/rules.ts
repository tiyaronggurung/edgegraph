// BTC 15m Operating Manual — pure rule engine.
//
// This module is the SINGLE source of truth for qualification, bucketing,
// status, staking mode and discipline scoring. Both the live qualification
// card and the historical backtest import from here, so they can never drift.
//
// No I/O, no imports, no side effects. Do not loosen these thresholds without
// recording the change in ops_threshold_changes.

// ---------------------------------------------------------------- thresholds

export const OPS_RULES = {
  MIN_STUDY_CONF_PCT: 90,
  MIN_CUSHION_USD: 40,
  // Hard price cap. 45 days of settled fills: 70–85¢ band = −13% ROI even at
  // 72.7% WR, sub-40¢ = +129% ROI. Above 70¢ we do not trade, ever.
  MAX_ASK_CENTS: 70,
  MIN_SECONDS_LEFT: 120,
  T7_LOCK_REQUIRED: true,
  // Fire AT the T7 lock. The measured 94-second delay dragged average entries
  // from ~40¢ to ~80¢ and is the single biggest EV leak in the book.
  MAX_LOCK_AGE_SECONDS: 45,
  // Our-odds confirmation at T7: implied prob >= 83.3% (−500) on the study
  // side. 273 windows that held that level and never flipped were right 94.1%.
  OUR_ODDS_CONFIRM_PROB: 0.833,
  EXCLUDED_UTC_HOURS: [1, 4, 11, 18] as const,
  PREFERRED_UTC_HOURS: [22, 0, 5, 6, 8, 13, 14] as const,

  MAX_BETS_PER_DAY: 4,
  // One loss ends the day. At a 5% unit two losses is −10% and erases a good
  // day; every account death in this system came from trading past the first.
  MAX_CONSECUTIVE_LOSSES: 1,
  DAILY_PROFIT_STOP_PCT: 0.20,
  DAILY_LOSS_STOP_PCT: 0.20,

  // Compounding unit: % of the morning bankroll, re-sized every day as the
  // bankroll grows. Tier steps down once capital is meaningful.
  UNIT_STANDARD_PCT: 0.05,          // below the tier-down bankroll
  UNIT_STANDARD_PCT_LARGE: 0.03,    // at/above UNIT_TIER_DOWN_BANKROLL
  UNIT_TIER_DOWN_BANKROLL: 10_000,
  RISK_REDUCED_MULTIPLIER: 0.6,     // risk-reduced = 60% of the standard unit
  UNIT_RISK_REDUCED_PCT: 0.03,      // legacy alias (5% × 0.6)

  WR_HEALTHY_30: 0.88,
  WR_WATCH_30: 0.82,
  WR_KILL_100: 0.78,
  MAX_DRAWDOWN_PCT: 0.30,
  RECOVERY_BETS_REQUIRED: 30,

  DEPTH_BANKROLL_THRESHOLD_USD: 40_000,
  MAX_DEPTH_FRACTION: 0.15,

  WITHDRAWAL_START_BANKROLL: 10_000,
  WITHDRAWAL_PCT: 0.20,
} as const;

// ------------------------------------------------------------------- types

export type FilterCode =
  | "t7_lock"
  | "study_conf"
  | "cushion"
  | "ask_price"
  | "model_agreement"
  | "time_left"
  | "hour_allowed"
  | "lock_fresh"
  | "our_odds_confirm";

export interface FilterResult {
  code: FilterCode;
  label: string;
  pass: boolean;
  actual: string;
  required: string;
}

export interface QualificationInput {
  hasT7Lock: boolean;
  studyConfPct: number | null;   // 0..100
  cushionUsd: number | null;     // |spot - strike|
  askCents: number | null;
  modelSide: string | null;      // "YES" | "NO"
  studySide: string | null;      // "YES" | "NO"
  secondsLeft: number | null;
  utcHour: number | null;
  /** Seconds elapsed since the T7 study lock was written. */
  lockAgeSeconds?: number | null;
  /** Our-odds implied probability (0..1) for the STUDY side, at/after T7. */
  ourOddsProbForSide?: number | null;
}

export interface QualificationResult {
  qualified: boolean;
  filters: FilterResult[];
  failReasons: string[];
  preferredHour: boolean;
}

// ----------------------------------------------------------- qualification

export function evaluateQualification(inp: QualificationInput): QualificationResult {
  const R = OPS_RULES;
  const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : n);

  const conf = num(inp.studyConfPct);
  const cush = num(inp.cushionUsd);
  const ask = num(inp.askCents);
  const secs = num(inp.secondsLeft);
  const hour = num(inp.utcHour);
  const lockAge = num(inp.lockAgeSeconds);
  const ourP = num(inp.ourOddsProbForSide);

  const agrees =
    !!inp.modelSide && !!inp.studySide &&
    inp.modelSide.toUpperCase() === inp.studySide.toUpperCase();

  const filters: FilterResult[] = [
    {
      code: "t7_lock",
      label: "T7 Study lock exists",
      pass: inp.hasT7Lock === true,
      actual: inp.hasT7Lock ? "locked" : "missing",
      required: "required",
    },
    {
      code: "study_conf",
      label: `Study confidence ≥ ${R.MIN_STUDY_CONF_PCT}%`,
      pass: conf != null && conf >= R.MIN_STUDY_CONF_PCT,
      actual: conf != null ? `${conf.toFixed(1)}%` : "—",
      required: `≥ ${R.MIN_STUDY_CONF_PCT}%`,
    },
    {
      code: "cushion",
      label: `Cushion ≥ $${R.MIN_CUSHION_USD}`,
      pass: cush != null && cush >= R.MIN_CUSHION_USD,
      actual: cush != null ? `$${cush.toFixed(0)}` : "—",
      required: `≥ $${R.MIN_CUSHION_USD}`,
    },
    {
      code: "ask_price",
      label: `Ask ≤ ${R.MAX_ASK_CENTS}¢`,
      pass: ask != null && ask <= R.MAX_ASK_CENTS,
      actual: ask != null ? `${ask}¢` : "—",
      required: `≤ ${R.MAX_ASK_CENTS}¢`,
    },
    {
      code: "model_agreement",
      label: "Model agrees with Study",
      pass: agrees,
      actual: `${inp.modelSide ?? "—"} vs ${inp.studySide ?? "—"}`,
      required: "match",
    },
    {
      code: "time_left",
      label: "≥ 2 minutes remain",
      pass: secs != null && secs >= R.MIN_SECONDS_LEFT,
      actual: secs != null ? `${secs}s` : "—",
      required: `≥ ${R.MIN_SECONDS_LEFT}s`,
    },
    {
      code: "hour_allowed",
      label: "UTC hour not 01/04/11/18",
      pass: hour != null && !(R.EXCLUDED_UTC_HOURS as readonly number[]).includes(hour),
      actual: hour != null ? `${String(hour).padStart(2, "0")}h` : "—",
      required: "allowed hour",
    },
    {
      code: "lock_fresh",
      label: `Fire at the lock (≤ ${R.MAX_LOCK_AGE_SECONDS}s old)`,
      pass: lockAge != null && lockAge <= R.MAX_LOCK_AGE_SECONDS,
      actual: lockAge != null ? `${lockAge}s since lock` : "—",
      required: `≤ ${R.MAX_LOCK_AGE_SECONDS}s`,
    },
    {
      code: "our_odds_confirm",
      // Unknown (no snapshot) does not veto — only a contradicting/weak
      // our-odds reading does.
      label: `Our odds ≥ ${(R.OUR_ODDS_CONFIRM_PROB * 100).toFixed(1)}% (−500) on study side`,
      pass: ourP == null || ourP >= R.OUR_ODDS_CONFIRM_PROB,
      actual: ourP != null ? `${(ourP * 100).toFixed(1)}%` : "no snapshot",
      required: `≥ ${(R.OUR_ODDS_CONFIRM_PROB * 100).toFixed(1)}%`,
    },
  ];

  const failReasons = filters.filter(f => !f.pass).map(f => f.code);
  return {
    qualified: failReasons.length === 0,
    filters,
    failReasons,
    preferredHour: hour != null && (R.PREFERRED_UTC_HOURS as readonly number[]).includes(hour),
  };
}

// ---------------------------------------------------------------- buckets

export const CUSHION_BUCKETS = [
  { key: "$40–49.99", min: 40, max: 50 },
  { key: "$50–59.99", min: 50, max: 60 },
  { key: "$60–79.99", min: 60, max: 80 },
  { key: "$80–99.99", min: 80, max: 100 },
  { key: "$100+", min: 100, max: Infinity },
] as const;

export const CONF_BUCKETS = [
  { key: "90–91.99%", min: 90, max: 92 },
  { key: "92–94.99%", min: 92, max: 95 },
  { key: "95–96.99%", min: 95, max: 97 },
  { key: "97%+", min: 97, max: Infinity },
] as const;

export const ASK_BUCKETS = [
  { key: "50–59¢", min: 50, max: 60 },
  { key: "60–69¢", min: 60, max: 70 },
  { key: "70–74¢", min: 70, max: 75 },
  { key: "75–80¢", min: 75, max: 80.001 },
] as const;

export function bucketOf(
  value: number | null,
  buckets: readonly { key: string; min: number; max: number }[],
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  for (const b of buckets) if (value >= b.min && value < b.max) return b.key;
  return null;
}

// ------------------------------------------------------------------ status

export type OpsStatus = "healthy" | "watch" | "risk_reduced" | "kill_switch";

export interface StatusInput {
  rolling30Wr: number | null;   // 0..1
  rolling100Wr: number | null;  // 0..1
  drawdownPct: number | null;   // 0..1
  settled100: number;
}

export interface StatusResult {
  status: OpsStatus;
  reason: string;
  metric: string;
  currentValue: number | null;
  thresholdValue: number;
}

export function computeStatus(inp: StatusInput): StatusResult {
  const R = OPS_RULES;
  if (inp.drawdownPct != null && inp.drawdownPct > R.MAX_DRAWDOWN_PCT) {
    return {
      status: "kill_switch",
      reason: `Drawdown ${(inp.drawdownPct * 100).toFixed(1)}% exceeds 30% of all-time high`,
      metric: "drawdown",
      currentValue: inp.drawdownPct,
      thresholdValue: R.MAX_DRAWDOWN_PCT,
    };
  }
  if (inp.settled100 >= 100 && inp.rolling100Wr != null && inp.rolling100Wr < R.WR_KILL_100) {
    return {
      status: "kill_switch",
      reason: `Rolling 100-bet win rate ${(inp.rolling100Wr * 100).toFixed(1)}% is below 78%`,
      metric: "rolling100_wr",
      currentValue: inp.rolling100Wr,
      thresholdValue: R.WR_KILL_100,
    };
  }
  const wr30 = inp.rolling30Wr;
  if (wr30 == null) {
    return {
      status: "watch",
      reason: "Insufficient settled history for a rolling 30-bet win rate",
      metric: "rolling30_wr",
      currentValue: null,
      thresholdValue: R.WR_HEALTHY_30,
    };
  }
  if (wr30 >= R.WR_HEALTHY_30) {
    return {
      status: "healthy",
      reason: `Rolling 30-bet win rate ${(wr30 * 100).toFixed(1)}% is at or above 88%`,
      metric: "rolling30_wr",
      currentValue: wr30,
      thresholdValue: R.WR_HEALTHY_30,
    };
  }
  if (wr30 >= R.WR_WATCH_30) {
    return {
      status: "watch",
      reason: `Rolling 30-bet win rate ${(wr30 * 100).toFixed(1)}% is between 82% and 88%`,
      metric: "rolling30_wr",
      currentValue: wr30,
      thresholdValue: R.WR_HEALTHY_30,
    };
  }
  return {
    status: "risk_reduced",
    reason: `Rolling 30-bet win rate ${(wr30 * 100).toFixed(1)}% is below 82%`,
    metric: "rolling30_wr",
    currentValue: wr30,
    thresholdValue: R.WR_WATCH_30,
  };
}

export const ALERT_LEVEL_BY_STATUS: Record<OpsStatus, "green" | "yellow" | "orange" | "red"> = {
  healthy: "green",
  watch: "yellow",
  risk_reduced: "orange",
  kill_switch: "red",
};

// ------------------------------------------------------------ staking mode

export type StakingMode = "standard" | "risk_reduced" | "disabled";

export interface StakingInput {
  morningBankroll: number;
  status: OpsStatus;
  feedOutage?: boolean;
  structureChange?: boolean;
  weeklyViolations?: number;
  betsSettledSinceRiskReduced?: number;
  manualDisable?: boolean;
}

export interface StakingResult {
  mode: StakingMode;
  unitPct: number;
  unitUsd: number;
  reason: string;
}

/** Compounding unit tier: 5% of bankroll, stepping down to 3% at $10k+. */
export function resolveStandardUnitPct(bankroll: number): number {
  const R = OPS_RULES;
  const bank = Math.max(0, bankroll || 0);
  return bank >= R.UNIT_TIER_DOWN_BANKROLL ? R.UNIT_STANDARD_PCT_LARGE : R.UNIT_STANDARD_PCT;
}

export function computeStakingMode(inp: StakingInput): StakingResult {
  const R = OPS_RULES;
  const bank = Math.max(0, inp.morningBankroll || 0);
  const disabled = (reason: string): StakingResult => ({
    mode: "disabled", unitPct: 0, unitUsd: 0, reason,
  });

  if (inp.manualDisable) return disabled("Trading manually disabled");
  if (inp.status === "kill_switch") return disabled("Kill switch active — a critical threshold was breached");
  if (inp.feedOutage) return disabled("Feed outage or stale tick detected");
  if (inp.structureChange) return disabled("Kalshi market structure, fee, or settlement source changed");
  if ((inp.weeklyViolations ?? 0) >= 2) return disabled("Two operating-rule violations occurred this week");

  const stdPct = resolveStandardUnitPct(bank);
  const pctLabel = (p: number) => `${(p * 100).toFixed(p * 100 % 1 === 0 ? 0 : 1)}%`;

  if (inp.status === "risk_reduced") {
    const settled = inp.betsSettledSinceRiskReduced ?? 0;
    const reducedPct = Math.round(stdPct * R.RISK_REDUCED_MULTIPLIER * 10000) / 10000;
    return {
      mode: "risk_reduced",
      unitPct: reducedPct,
      unitUsd: round2(bank * reducedPct),
      reason: `Rolling 30-bet win rate below 82% — ${pctLabel(reducedPct)} unit until ${Math.max(0, R.RECOVERY_BETS_REQUIRED - settled)} more settled bets recover the rate`,
    };
  }

  const tierNote =
    bank >= R.UNIT_TIER_DOWN_BANKROLL
      ? ` (bankroll ≥ $${(R.UNIT_TIER_DOWN_BANKROLL / 1000).toFixed(0)}k — capital-protection tier)`
      : "";

  return {
    mode: "standard",
    unitPct: stdPct,
    unitUsd: round2(bank * stdPct),
    reason:
      (inp.status === "healthy"
        ? `Rolling 30-bet win rate ≥ 88% — compounding ${pctLabel(stdPct)} unit`
        : `Rolling 30-bet win rate 82–88% — compounding ${pctLabel(stdPct)} unit, watch level`) + tierNote,
  };
}

// ------------------------------------------------------------- daily stops

export interface DailyStopInput {
  betsPlaced: number;
  consecutiveLosses: number;
  dailyPnl: number;
  morningBankroll: number;
  ruleViolationToday?: boolean;
  feedOutage?: boolean;
  isSunday?: boolean;
}

export interface DailyStopResult {
  stopped: boolean;
  reason: string | null;
  betsRemaining: number;
  distanceToProfitStopUsd: number;
  distanceToLossStopUsd: number;
  profitStopUsd: number;
  lossStopUsd: number;
}

export function evaluateDailyStops(inp: DailyStopInput): DailyStopResult {
  const R = OPS_RULES;
  const bank = Math.max(0, inp.morningBankroll || 0);
  const profitStop = round2(bank * R.DAILY_PROFIT_STOP_PCT);
  const lossStop = round2(-bank * R.DAILY_LOSS_STOP_PCT);

  let reason: string | null = null;
  if (inp.isSunday) reason = "Sunday — review-only mode, no live trades";
  else if (inp.feedOutage) reason = "Feed outage or stale market data";
  else if (inp.ruleViolationToday) reason = "A rule violation occurred today";
  else if (inp.betsPlaced >= R.MAX_BETS_PER_DAY) reason = `Daily limit of ${R.MAX_BETS_PER_DAY} bets reached`;
  else if (inp.consecutiveLosses >= R.MAX_CONSECUTIVE_LOSSES) reason = "Two consecutive losses";
  else if (inp.dailyPnl >= profitStop && profitStop > 0) reason = "Daily +20% profit stop reached";
  else if (inp.dailyPnl <= lossStop && lossStop < 0) reason = "Daily −20% loss stop reached";

  return {
    stopped: reason != null,
    reason,
    betsRemaining: Math.max(0, R.MAX_BETS_PER_DAY - inp.betsPlaced),
    distanceToProfitStopUsd: round2(profitStop - inp.dailyPnl),
    distanceToLossStopUsd: round2(inp.dailyPnl - lossStop),
    profitStopUsd: profitStop,
    lossStopUsd: lossStop,
  };
}

// --------------------------------------------------------- market depth

export function checkDepth(
  bankroll: number,
  stakeUsd: number,
  visibleDepthUsd: number | null,
): { applies: boolean; ok: boolean; message: string } {
  const R = OPS_RULES;
  if (bankroll < R.DEPTH_BANKROLL_THRESHOLD_USD) {
    return { applies: false, ok: true, message: "Depth protection inactive below $40k bankroll" };
  }
  if (visibleDepthUsd == null || !Number.isFinite(visibleDepthUsd) || visibleDepthUsd <= 0) {
    return { applies: true, ok: false, message: "Visible book depth unknown — treat as failing, do not place" };
  }
  const frac = stakeUsd / visibleDepthUsd;
  if (frac > R.MAX_DEPTH_FRACTION) {
    return {
      applies: true,
      ok: false,
      message: `Order is ${(frac * 100).toFixed(1)}% of visible depth (max 15%) — SPLIT ENTRY REQUIRED, do not auto-place`,
    };
  }
  return { applies: true, ok: true, message: `Order is ${(frac * 100).toFixed(1)}% of visible depth` };
}

// -------------------------------------------------------- discipline score

export const DISCIPLINE_RULES = [
  { code: "t7_lock", label: "T7 lock requirement", penalty: 20 },
  { code: "study_conf", label: "Confidence requirement", penalty: 15 },
  { code: "cushion", label: "Cushion requirement", penalty: 15 },
  { code: "ask_price", label: "Ask-price requirement", penalty: 10 },
  { code: "model_agreement", label: "Model agreement requirement", penalty: 15 },
  { code: "time_left", label: "Time-left requirement", penalty: 10 },
  { code: "hour_allowed", label: "Hour restriction", penalty: 5 },
  { code: "lock_fresh", label: "Fire-at-lock requirement", penalty: 20 },
  { code: "our_odds_confirm", label: "Our-odds −500 confirmation", penalty: 10 },
  { code: "daily_limit", label: "Daily bet limit", penalty: 20 },
  { code: "daily_stop", label: "Daily stop rules", penalty: 25 },
  { code: "staking", label: "Staking rule", penalty: 20 },
  { code: "logging", label: "Logging requirement", penalty: 5 },
] as const;

export function disciplineScore(violations: readonly string[]): number {
  let score = 100;
  for (const v of violations) {
    const rule = DISCIPLINE_RULES.find(r => r.code === v);
    score -= rule ? rule.penalty : 10;
  }
  return Math.max(0, score);
}

// --------------------------------------------------------- withdrawals

export interface Milestone {
  from: number;
  to: number;
  required: number;
}

export const WITHDRAWAL_MILESTONES: Milestone[] = [
  { from: 10_000, to: 20_000, required: 2_000 },
  { from: 20_000, to: 40_000, required: 4_000 },
  { from: 40_000, to: 80_000, required: 8_000 },
  { from: 80_000, to: 100_000, required: 4_000 },
];

export function nextMilestone(bankroll: number): Milestone | null {
  for (const m of WITHDRAWAL_MILESTONES) if (bankroll < m.to) return m;
  return null;
}

// -------------------------------------------------------------- statistics

export interface SettledBet {
  won: boolean;
  pnl: number;
  stake: number;
  askCents: number | null;
  confPct: number | null;
  cushionUsd: number | null;
  utcHour: number | null;
  studyCorrect?: boolean | null;
  modelCorrect?: boolean | null;
  agreed?: boolean;
}

export interface PeriodMetrics {
  qualifyingWindows: number;
  betsTaken: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  returnOnStake: number | null;
  avgAsk: number | null;
  avgConfidence: number | null;
  avgCushion: number | null;
  avgProfitPerBet: number | null;
  maxConsecutiveLosses: number;
  maxDrawdown: number;
  profitFactor: number | null;
  evPerBet: number | null;
  studyOnlyAccuracy: number | null;
  modelOnlyAccuracy: number | null;
  agreementAccuracy: number | null;
  byHour: BucketStat[];
  byCushion: BucketStat[];
  byConfidence: BucketStat[];
  byAsk: BucketStat[];
}

export interface BucketStat {
  key: string;
  n: number;
  wins: number;
  winRate: number | null;
  pnl: number;
}

function agg(key: string, rows: SettledBet[]): BucketStat {
  const wins = rows.filter(r => r.won).length;
  const pnl = rows.reduce((s, r) => s + r.pnl, 0);
  return {
    key,
    n: rows.length,
    wins,
    winRate: rows.length ? wins / rows.length : null,
    pnl: round2(pnl),
  };
}

export function computePeriodMetrics(
  bets: SettledBet[],
  qualifyingWindows: number,
): PeriodMetrics {
  const n = bets.length;
  const wins = bets.filter(b => b.won).length;
  const losses = n - wins;
  const netPnl = bets.reduce((s, b) => s + b.pnl, 0);
  const totalStake = bets.reduce((s, b) => s + b.stake, 0);

  let streak = 0, maxStreak = 0;
  let equity = 0, peak = 0, maxDd = 0;
  for (const b of bets) {
    if (b.won) streak = 0; else { streak++; maxStreak = Math.max(maxStreak, streak); }
    equity += b.pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const grossWin = bets.filter(b => b.won).reduce((s, b) => s + b.pnl, 0);
  const grossLoss = Math.abs(bets.filter(b => !b.won).reduce((s, b) => s + b.pnl, 0));

  const avg = (vals: (number | null)[]) => {
    const f = vals.filter((v): v is number => v != null && Number.isFinite(v));
    return f.length ? f.reduce((s, v) => s + v, 0) / f.length : null;
  };
  const acc = (vals: (boolean | null | undefined)[]) => {
    const f = vals.filter((v): v is boolean => typeof v === "boolean");
    return f.length ? f.filter(Boolean).length / f.length : null;
  };

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return {
    qualifyingWindows,
    betsTaken: n,
    wins,
    losses,
    winRate: n ? wins / n : null,
    netPnl: round2(netPnl),
    returnOnStake: totalStake > 0 ? netPnl / totalStake : null,
    avgAsk: avg(bets.map(b => b.askCents)),
    avgConfidence: avg(bets.map(b => b.confPct)),
    avgCushion: avg(bets.map(b => b.cushionUsd)),
    avgProfitPerBet: n ? round2(netPnl / n) : null,
    maxConsecutiveLosses: maxStreak,
    maxDrawdown: round2(maxDd),
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : (grossWin > 0 ? null : null),
    evPerBet: n ? round2(netPnl / n) : null,
    studyOnlyAccuracy: acc(bets.map(b => b.studyCorrect)),
    modelOnlyAccuracy: acc(bets.map(b => b.modelCorrect)),
    agreementAccuracy: acc(bets.filter(b => b.agreed).map(b => b.studyCorrect)),
    byHour: hours
      .map(h => agg(String(h).padStart(2, "0"), bets.filter(b => b.utcHour === h)))
      .filter(s => s.n > 0),
    byCushion: CUSHION_BUCKETS.map(b =>
      agg(b.key, bets.filter(x => bucketOf(x.cushionUsd, CUSHION_BUCKETS) === b.key))),
    byConfidence: CONF_BUCKETS.map(b =>
      agg(b.key, bets.filter(x => bucketOf(x.confPct, CONF_BUCKETS) === b.key))),
    byAsk: ASK_BUCKETS.map(b =>
      agg(b.key, bets.filter(x => bucketOf(x.askCents, ASK_BUCKETS) === b.key))),
  };
}

export function rollingWinRate(bets: readonly { won: boolean }[], n: number): number | null {
  if (bets.length === 0) return null;
  const slice = bets.slice(-n);
  return slice.filter(b => b.won).length / slice.length;
}

export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}
