// Server-only helpers for the BTC 15m Operating Manual.
//
// Backtest integrity: reconstruction reads ONLY the decision-time columns that
// were written at T7 (study_t7_*, model_side_pre_study, model_prob,
// study_lock_kalshi_price_cents, strike). Settlement columns (outcome,
// was_correct, settle_price) are used exclusively to GRADE the reconstructed
// decision — never to decide whether it qualified.

import {
  evaluateQualification,
  computePeriodMetrics,
  computeStatus,
  rollingWinRate,
  round2,
  type SettledBet,
  type PeriodMetrics,
  type OpsStatus,
} from "./rules";

export const BACKTEST_STAKE = 100; // normalized unit for return-on-stake comparability

export interface ReconstructedWindow {
  ticker: string;
  closeTime: string;
  utcHour: number;
  qualified: boolean;
  failReasons: string[];
  preferredHour: boolean;
  studySide: string | null;
  studyConf: number | null;
  modelSide: string | null;
  modelConf: number | null;
  cushionUsd: number | null;
  askCents: number | null;
  secondsLeft: number | null;
  outcome: string | null;
  settled: boolean;
  won: boolean | null;
  pnl: number | null;
}

interface PredRow {
  ticker: string;
  close_time: string;
  strike: number | string | null;
  side: string | null;
  model_side_pre_study: string | null;
  model_prob: number | string | null;
  study_t7_side: string | null;
  study_t7_conf: number | string | null;
  study_t7_spot: number | string | null;
  study_t7_seconds_to_close: number | null;
  study_t7_at: string | null;
  study_lock_kalshi_price_cents: number | null;
  outcome: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function reconstructWindow(row: PredRow): ReconstructedWindow {
  const strike = num(row.strike);
  const t7Spot = num(row.study_t7_spot);
  const studySide = row.study_t7_side ? row.study_t7_side.toUpperCase() : null;
  // study_t7_conf is stored 0..1 in some rows and 0..100 in others — normalize.
  const rawConf = num(row.study_t7_conf);
  const studyConf = rawConf == null ? null : rawConf <= 1 ? rawConf * 100 : rawConf;
  const modelSideRaw = row.model_side_pre_study ?? row.side ?? null;
  const modelSide = modelSideRaw ? modelSideRaw.toUpperCase() : null;
  const modelProb = num(row.model_prob);
  const cushion = strike != null && t7Spot != null ? Math.abs(t7Spot - strike) : null;
  const askCents = row.study_lock_kalshi_price_cents ?? null;
  const secondsLeft = row.study_t7_seconds_to_close ?? null;
  const closeMs = Date.parse(row.close_time);
  const utcHour = Number.isFinite(closeMs) ? new Date(closeMs).getUTCHours() : 0;

  const q = evaluateQualification({
    hasT7Lock: !!studySide && row.study_t7_at != null,
    studyConfPct: studyConf,
    cushionUsd: cushion,
    askCents,
    modelSide,
    studySide,
    secondsLeft,
    utcHour,
  });

  const outcome = row.outcome;
  const settled = outcome === "YES" || outcome === "NO";
  const won = settled && studySide ? studySide === outcome : null;
  let pnl: number | null = null;
  if (settled && won != null && askCents != null && askCents > 0) {
    pnl = won ? round2(BACKTEST_STAKE * ((100 - askCents) / askCents)) : -BACKTEST_STAKE;
  }

  return {
    ticker: row.ticker,
    closeTime: row.close_time,
    utcHour,
    qualified: q.qualified,
    failReasons: q.failReasons,
    preferredHour: q.preferredHour,
    studySide,
    studyConf,
    modelSide,
    modelConf: modelProb == null ? null : modelProb <= 1 ? modelProb * 100 : modelProb,
    cushionUsd: cushion,
    askCents,
    secondsLeft,
    outcome,
    settled,
    won,
    pnl,
  };
}

function toSettledBet(w: ReconstructedWindow): SettledBet {
  const studyCorrect = w.studySide != null && w.outcome != null ? w.studySide === w.outcome : null;
  const modelCorrect = w.modelSide != null && w.outcome != null ? w.modelSide === w.outcome : null;
  return {
    won: w.won === true,
    pnl: w.pnl ?? 0,
    stake: BACKTEST_STAKE,
    askCents: w.askCents,
    confPct: w.studyConf,
    cushionUsd: w.cushionUsd,
    utcHour: w.utcHour,
    studyCorrect,
    modelCorrect,
    agreed: w.studySide != null && w.modelSide != null && w.studySide === w.modelSide,
  };
}

export interface BacktestPeriod {
  label: string;
  metrics: PeriodMetrics;
}

export interface BacktestOutput {
  runAt: string;
  totalWindows: number;
  qualifiedWindows: number;
  periods: BacktestPeriod[];
  preferredHours: PeriodMetrics;
  status: OpsStatus;
  statusReason: string;
  rolling30Wr: number | null;
  rolling100Wr: number | null;
  maxDrawdownPct: number | null;
  recentWindows: ReconstructedWindow[];
  failReasonTally: { reason: string; n: number }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runOpsBacktest(supabase: any): Promise<BacktestOutput> {
  const { data, error } = await supabase
    .from("btc_model_predictions")
    .select(
      "ticker, close_time, strike, side, model_side_pre_study, model_prob, study_t7_side, study_t7_conf, study_t7_spot, study_t7_seconds_to_close, study_t7_at, study_lock_kalshi_price_cents, outcome",
    )
    .order("close_time", { ascending: true })
    .limit(20000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PredRow[];
  const windows = rows.map(reconstructWindow);
  const qualified = windows.filter((w) => w.qualified);
  const settledQualified = qualified.filter((w) => w.settled && w.pnl != null);

  const nowMs = Date.now();
  const inDays = (w: ReconstructedWindow, days: number) =>
    Date.parse(w.closeTime) >= nowMs - days * 86_400_000;

  const periodOf = (
    label: string,
    bets: ReconstructedWindow[],
    qualWindows: number,
  ): BacktestPeriod => ({
    label,
    metrics: computePeriodMetrics(bets.map(toSettledBet), qualWindows),
  });

  const last30 = settledQualified.slice(-30);
  const last100 = settledQualified.slice(-100);
  const d7 = settledQualified.filter((w) => inDays(w, 7));
  const d30 = settledQualified.filter((w) => inDays(w, 30));

  const periods: BacktestPeriod[] = [
    periodOf("Last 30 qualifying bets", last30, last30.length),
    periodOf("Last 100 qualifying bets", last100, last100.length),
    periodOf("Last 7 days", d7, qualified.filter((w) => inDays(w, 7)).length),
    periodOf("Last 30 days", d30, qualified.filter((w) => inDays(w, 30)).length),
    periodOf("All history", settledQualified, qualified.length),
  ];

  const preferred = settledQualified.filter((w) => w.preferredHour);

  const wr30 = rollingWinRate(settledQualified.map((w) => ({ won: w.won === true })), 30);
  const wr100 = rollingWinRate(settledQualified.map((w) => ({ won: w.won === true })), 100);

  // Drawdown as a fraction of running peak equity (seeded at ten units).
  let equity = BACKTEST_STAKE * 10;
  let peak = equity;
  let maxDdPct = 0;
  for (const w of settledQualified) {
    equity += w.pnl ?? 0;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (peak - equity) / peak);
  }

  const st = computeStatus({
    rolling30Wr: wr30,
    rolling100Wr: wr100,
    drawdownPct: maxDdPct,
    settled100: settledQualified.length,
  });

  const tally = new Map<string, number>();
  for (const w of windows) for (const r of w.failReasons) tally.set(r, (tally.get(r) ?? 0) + 1);

  return {
    runAt: new Date().toISOString(),
    totalWindows: windows.length,
    qualifiedWindows: qualified.length,
    periods,
    preferredHours: computePeriodMetrics(preferred.map(toSettledBet), preferred.length),
    status: st.status,
    statusReason: st.reason,
    rolling30Wr: wr30,
    rolling100Wr: wr100,
    maxDrawdownPct: Math.round(maxDdPct * 10000) / 10000,
    recentWindows: windows.slice(-120).reverse(),
    failReasonTally: [...tally.entries()]
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n),
  };
}

// ------------------------------------------------------- ledger aggregation

export interface LedgerTrade {
  id: string;
  session_date: string;
  ticker: string;
  decision_at: string;
  utc_hour: number | null;
  strike: number | null;
  side: string | null;
  study_side: string | null;
  study_conf: number | null;
  model_side: string | null;
  model_conf: number | null;
  spot_at_lock: number | null;
  cushion_usd: number | null;
  ask_cents: number | null;
  seconds_left: number | null;
  stake: number;
  potential_profit: number | null;
  result: string | null;
  realized_pnl: number | null;
  bankroll_after: number | null;
  rule_status: string;
  violations: string[];
  discipline_score: number;
  notes: string | null;
}

export interface LedgerSummary {
  currentBankroll: number;
  allTimeHigh: number;
  drawdownPct: number;
  todayPnl: number;
  weekPnl: number;
  monthPnl: number;
  allTimePnl: number;
  withdrawn: number;
  activeBankroll: number;
  totalWins: number;
  totalLosses: number;
  overallWinRate: number | null;
  rolling30Wr: number | null;
  rolling100Wr: number | null;
  avgDisciplineScore: number | null;
  bankrollCurve: { t: string; bankroll: number }[];
  drawdownCurve: { t: string; ddPct: number }[];
  dailyPnl: { d: string; pnl: number }[];
  weeklyPnl: { w: string; pnl: number }[];
  rolling30Curve: { i: number; wr: number }[];
  rolling100Curve: { i: number; wr: number }[];
}

export function summarizeLedger(
  trades: LedgerTrade[],
  seedBankroll: number,
  withdrawn: number,
): LedgerSummary {
  const settled = trades
    .filter((t) => t.result === "win" || t.result === "loss")
    .sort((a, b) => Date.parse(a.decision_at) - Date.parse(b.decision_at));

  let bankroll = seedBankroll;
  let ath = seedBankroll;
  const bankrollCurve: { t: string; bankroll: number }[] = [];
  const drawdownCurve: { t: string; ddPct: number }[] = [];
  const wonSeq: boolean[] = [];

  for (const t of settled) {
    bankroll += t.realized_pnl ?? 0;
    ath = Math.max(ath, bankroll);
    bankrollCurve.push({ t: t.decision_at, bankroll: round2(bankroll) });
    drawdownCurve.push({
      t: t.decision_at,
      ddPct: ath > 0 ? round2(((ath - bankroll) / ath) * 100) : 0,
    });
    wonSeq.push(t.result === "win");
  }

  const rollCurve = (n: number) =>
    wonSeq
      .map((_, i) => {
        if (i + 1 < n) return null;
        const slice = wonSeq.slice(i + 1 - n, i + 1);
        return { i: i + 1, wr: round2((slice.filter(Boolean).length / n) * 100) };
      })
      .filter((x): x is { i: number; wr: number } => x != null);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const monthAgo = Date.now() - 30 * 86_400_000;
  const sum = (rows: LedgerTrade[]) => round2(rows.reduce((s, r) => s + (r.realized_pnl ?? 0), 0));

  const byDay = new Map<string, number>();
  const byWeek = new Map<string, number>();
  for (const t of settled) {
    const d = t.session_date;
    byDay.set(d, round2((byDay.get(d) ?? 0) + (t.realized_pnl ?? 0)));
    const dt = new Date(t.decision_at);
    const yr = dt.getUTCFullYear();
    const week = Math.floor(
      (Date.UTC(yr, dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(yr, 0, 1)) / (7 * 86_400_000),
    );
    const wk = `${yr}-W${String(week + 1).padStart(2, "0")}`;
    byWeek.set(wk, round2((byWeek.get(wk) ?? 0) + (t.realized_pnl ?? 0)));
  }

  const wins = settled.filter((t) => t.result === "win").length;
  const losses = settled.length - wins;
  const scores = trades.map((t) => t.discipline_score).filter((n) => Number.isFinite(n));

  return {
    currentBankroll: round2(bankroll),
    allTimeHigh: round2(ath),
    drawdownPct: ath > 0 ? round2(((ath - bankroll) / ath) * 100) : 0,
    todayPnl: sum(settled.filter((t) => Date.parse(t.decision_at) >= startOfDay.getTime())),
    weekPnl: sum(settled.filter((t) => Date.parse(t.decision_at) >= weekAgo)),
    monthPnl: sum(settled.filter((t) => Date.parse(t.decision_at) >= monthAgo)),
    allTimePnl: sum(settled),
    withdrawn: round2(withdrawn),
    activeBankroll: round2(bankroll - withdrawn),
    totalWins: wins,
    totalLosses: losses,
    overallWinRate: settled.length ? wins / settled.length : null,
    rolling30Wr: rollingWinRate(wonSeq.map((won) => ({ won })), 30),
    rolling100Wr: rollingWinRate(wonSeq.map((won) => ({ won })), 100),
    avgDisciplineScore: scores.length ? round2(scores.reduce((s, n) => s + n, 0) / scores.length) : null,
    bankrollCurve,
    drawdownCurve,
    dailyPnl: [...byDay.entries()].map(([d, pnl]) => ({ d, pnl })).sort((a, b) => a.d.localeCompare(b.d)),
    weeklyPnl: [...byWeek.entries()].map(([w, pnl]) => ({ w, pnl })).sort((a, b) => a.w.localeCompare(b.w)),
    rolling30Curve: rollCurve(30),
    rolling100Curve: rollCurve(100),
  };
}
