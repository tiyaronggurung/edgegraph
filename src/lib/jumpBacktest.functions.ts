// Five-policy jump-detection backtest — WINDOW-LEVEL primary analysis.
// Groups snapshots by 15m contract window (ticker|strike|close_time) and, per
// policy, picks the FIRST chronological snapshot that is eligible under that
// policy. Bootstrap 95% CI resamples windows (not snapshots). Read-only:
// no live gates, stakes, exits, or applied calibration are touched.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- Configurable thresholds (not gate values — analysis knobs) ----
export const JUMP_BT_CONFIG = {
  jumpRatioActiveThreshold: 1.5,
  compressionK: 0.35,
  extraEdgePtsWhenJumping: 5,
  stakeUsd: 100,
  bootstrapIters: 200,
  walkforwardHoldoutDays: 2,
  highConfidenceLo: 0.12,
  highConfidenceHi: 0.88,
} as const;

type Policy = "A_baseline" | "B_skip_active" | "C_compress" | "D_sigma_inflate" | "E_larger_edge";
const POLICIES: Policy[] = ["A_baseline", "B_skip_active", "C_compress", "D_sigma_inflate", "E_larger_edge"];

export interface PolicyResult {
  policy: Policy;
  segment: string;
  n_predictions: number;   // snapshots considered
  n_windows_seen: number;  // unique windows in this segment
  n_trades: number;        // accepted trades (one per window at most, in window mode)
  wins: number;
  losses: number;
  win_rate: number;
  brier: number;
  log_loss: number;
  ece: number;
  mean_signed_edge_pts: number;
  pnl_usd: number;
  roc_pct: number;
  max_drawdown_usd: number;
  worst_losing_streak: number;
  avoided_wins: number;
  avoided_losses: number;
  avoided_wins_usd: number;
  avoided_losses_usd: number;
  pnl_ci_low_usd: number | null;
  pnl_ci_high_usd: number | null;
  delta_vs_baseline_pnl_usd: number;
  delta_vs_baseline_brier: number;
}

export interface WalkForwardSlice {
  label: "train" | "test";
  fromIso: string;
  toIso: string;
  days: string[];
  results: PolicyResult[];
}

export interface JumpBacktestResponse {
  totalRows: number;
  eligibleRows: number;
  windows: number;
  fromIso: string;
  toIso: string;
  analysisMode: "window";
  results: PolicyResult[];          // window-level, all + segments
  snapshotResults: PolicyResult[];  // snapshot-level (secondary/correlated view)
  pocket88: PolicyResult[];         // high-confidence pocket, window-level
  walkForward: WalkForwardSlice[];  // [train, test]
  sourceSplit: {                    // primary vs fallback vs combined, window-level, "all" segment
    primary: PolicyResult[];
    fallback: PolicyResult[];
    combined: PolicyResult[];
    counts: { primary: number; fallback: number; unknown: number };
  };
  perDay: Array<{ day: string; policy: Policy; n_trades: number; pnl_usd: number; win_rate: number; brier: number }>;
  foldSplitKey: string;
}

// -------- Math helpers --------
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function diffusionProb(spot: number, strike: number, sigmaMinPct: number, secondsToClose: number, side: "YES" | "NO"): number {
  if (!(spot > 0) || !(strike > 0) || !(sigmaMinPct > 0) || !(secondsToClose > 0)) return 0.5;
  const minutes = secondsToClose / 60;
  const sigma = (sigmaMinPct / 100) * Math.sqrt(minutes);
  if (sigma <= 0) return spot >= strike ? 1 : 0;
  const d = (Math.log(strike / spot) + 0.5 * sigma * sigma) / sigma;
  const pUp = 1 - normCdf(d);
  return side === "YES" ? pUp : 1 - pUp;
}

function sigmaInflationMult(jumpRatio: number | null): number {
  if (jumpRatio == null || !Number.isFinite(jumpRatio)) return 1;
  if (jumpRatio < 1.0) return 1.0;
  if (jumpRatio < 1.5) return 1.0 + 0.25 * (jumpRatio - 1.0) / 0.5;
  if (jumpRatio < 2.0) return 1.25 + 0.35 * (jumpRatio - 1.5) / 0.5;
  return 2.0;
}

interface JF { available?: boolean; source_quality?: "primary" | "odds_tape_fallback" | "none"; extra?: { jumpRatio15s?: number | null; jumpRatio30s?: number | null; contested?: boolean; sideMovementBps?: number | null; } }

interface SimRow {
  id: string;
  windowKey: string;
  day: string;
  side: "YES" | "NO";
  modelProb: number;
  marketAsk: number;
  edgePts: number;
  spot: number;
  strike: number;
  sigmaMin: number;
  secondsToClose: number;
  won: boolean;
  jumpRatio: number | null;
  contested: boolean;
  sourceQuality: "primary" | "odds_tape_fallback" | "unknown";
  sideMovementBps: number | null;
}


function applyPolicy(policy: Policy, r: SimRow): { accept: boolean; prob: number } {
  const jr = r.jumpRatio ?? 0;
  const active = jr >= JUMP_BT_CONFIG.jumpRatioActiveThreshold;
  switch (policy) {
    case "A_baseline":
      return { accept: true, prob: r.modelProb };
    case "B_skip_active":
      if (active && r.contested) return { accept: false, prob: r.modelProb };
      return { accept: true, prob: r.modelProb };
    case "C_compress": {
      const compressed = 0.5 + (r.modelProb - 0.5) * Math.exp(-JUMP_BT_CONFIG.compressionK * Math.max(0, jr));
      return { accept: true, prob: compressed };
    }
    case "D_sigma_inflate": {
      const mult = sigmaInflationMult(r.jumpRatio);
      const inflatedProb = diffusionProb(r.spot, r.strike, r.sigmaMin * mult, r.secondsToClose, r.side);
      return { accept: true, prob: inflatedProb };
    }
    case "E_larger_edge": {
      const edgeReq = active ? JUMP_BT_CONFIG.extraEdgePtsWhenJumping : 0;
      if ((r.edgePts * 100) < edgeReq) return { accept: false, prob: r.modelProb };
      return { accept: true, prob: r.modelProb };
    }
  }
}

interface TradeOutcome { pnl: number; brier: number; won: boolean; prob: number; edgePts: number; }

function tradeFromRow(r: SimRow, prob: number): TradeOutcome {
  const stake = JUMP_BT_CONFIG.stakeUsd;
  const contracts = stake / Math.max(0.01, r.marketAsk);
  const gross = r.won ? contracts * 1 : 0;
  return {
    pnl: gross - stake,
    brier: (prob - (r.won ? 1 : 0)) ** 2,
    won: r.won,
    prob,
    edgePts: (prob - r.marketAsk) * 100,
  };
}

// Snapshot-level unit: treat each row as an independent bet.
function snapshotUnits(policy: Policy, rows: SimRow[]): Array<{ groupKey: string; row: SimRow; accepted: boolean; prob: number; trade: TradeOutcome | null }> {
  return rows.map(r => {
    const { accept, prob } = applyPolicy(policy, r);
    return {
      groupKey: r.id,
      row: r,
      accepted: accept,
      prob,
      trade: accept ? tradeFromRow(r, prob) : null,
    };
  });
}

// Window-level unit: per policy, per window, pick the FIRST chronological
// snapshot that is eligible under that policy. If none eligible → not traded.
function windowUnits(policy: Policy, rows: SimRow[]): Array<{ groupKey: string; row: SimRow; accepted: boolean; prob: number; trade: TradeOutcome | null }> {
  const byWindow = new Map<string, SimRow[]>();
  for (const r of rows) {
    if (!byWindow.has(r.windowKey)) byWindow.set(r.windowKey, []);
    byWindow.get(r.windowKey)!.push(r);
  }
  const out: Array<{ groupKey: string; row: SimRow; accepted: boolean; prob: number; trade: TradeOutcome | null }> = [];
  for (const [wk, list] of byWindow) {
    // Earliest chronologically = highest secondsToClose (furthest from expiry).
    list.sort((a, b) => b.secondsToClose - a.secondsToClose);
    let chosen: { row: SimRow; prob: number } | null = null;
    for (const r of list) {
      const { accept, prob } = applyPolicy(policy, r);
      if (accept) { chosen = { row: r, prob }; break; }
    }
    if (chosen) {
      out.push({ groupKey: wk, row: chosen.row, accepted: true, prob: chosen.prob, trade: tradeFromRow(chosen.row, chosen.prob) });
    } else {
      // Represent skipped window with its earliest snapshot for calibration bookkeeping.
      const r = list[0];
      const { prob } = applyPolicy(policy, r);
      out.push({ groupKey: wk, row: r, accepted: false, prob, trade: null });
    }
  }
  return out;
}

function bootstrapCI(pnls: number[], iters: number): { lo: number; hi: number } | null {
  if (pnls.length < 5) return null;
  const draws: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < pnls.length; j++) {
      sum += pnls[Math.floor(Math.random() * pnls.length)];
    }
    draws.push(sum);
  }
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * draws.length)];
  const hi = draws[Math.min(draws.length - 1, Math.floor(0.975 * draws.length))];
  return { lo, hi };
}

function summarize(
  policy: Policy,
  segment: string,
  units: Array<{ groupKey: string; row: SimRow; accepted: boolean; prob: number; trade: TradeOutcome | null }>,
  baseline?: { pnl_usd: number; brier: number },
  bootstrap = false,
): PolicyResult {
  let n_pred = 0;
  const uniqueWindows = new Set<string>();
  let wins = 0, losses = 0;
  let brierSum = 0, brierN = 0, logLossSum = 0;
  let edgeSum = 0, tradeCount = 0, pnl = 0;
  let peak = 0, dd = 0, streak = 0, worstStreak = 0;
  let avoidedWins = 0, avoidedLosses = 0;
  let avoidedWinsUsd = 0, avoidedLossesUsd = 0;
  const perWindowPnl: number[] = [];

  const bins: { sumP: number; sumY: number; n: number }[] = Array.from({ length: 10 }, () => ({ sumP: 0, sumY: 0, n: 0 }));

  for (const u of units) {
    n_pred++;
    uniqueWindows.add(u.row.windowKey);
    const y = u.row.won ? 1 : 0;
    brierSum += (u.prob - y) ** 2;
    brierN++;
    logLossSum += -(y * Math.log(Math.max(1e-6, u.prob)) + (1 - y) * Math.log(Math.max(1e-6, 1 - u.prob)));

    if (!u.accepted || !u.trade) {
      // What would baseline have earned on this row?
      const shadow = tradeFromRow(u.row, u.row.modelProb);
      if (u.row.won) { avoidedWins++; avoidedWinsUsd += shadow.pnl; }
      else { avoidedLosses++; avoidedLossesUsd += shadow.pnl; }
      continue;
    }

    tradeCount++;
    edgeSum += u.trade.edgePts;
    pnl += u.trade.pnl;
    perWindowPnl.push(u.trade.pnl);
    if (pnl > peak) peak = pnl;
    if (peak - pnl > dd) dd = peak - pnl;
    if (u.row.won) { wins++; streak = 0; } else { losses++; streak++; if (streak > worstStreak) worstStreak = streak; }

    const bi = Math.min(9, Math.max(0, Math.floor(u.prob * 10)));
    bins[bi].sumP += u.prob;
    bins[bi].sumY += y;
    bins[bi].n++;
  }

  const total = bins.reduce((s, b) => s + b.n, 0) || 1;
  const ece = bins.reduce((s, b) => b.n > 0 ? s + (b.n / total) * Math.abs(b.sumP / b.n - b.sumY / b.n) : s, 0);
  const brier = brierN ? brierSum / brierN : 0;
  const logLoss = brierN ? logLossSum / brierN : 0;
  const ci = bootstrap ? bootstrapCI(perWindowPnl, JUMP_BT_CONFIG.bootstrapIters) : null;

  return {
    policy,
    segment,
    n_predictions: n_pred,
    n_windows_seen: uniqueWindows.size,
    n_trades: tradeCount,
    wins,
    losses,
    win_rate: tradeCount ? wins / tradeCount : 0,
    brier,
    log_loss: logLoss,
    ece,
    mean_signed_edge_pts: tradeCount ? edgeSum / tradeCount : 0,
    pnl_usd: pnl,
    roc_pct: tradeCount ? pnl / (tradeCount * JUMP_BT_CONFIG.stakeUsd) : 0,
    max_drawdown_usd: dd,
    worst_losing_streak: worstStreak,
    avoided_wins: avoidedWins,
    avoided_losses: avoidedLosses,
    avoided_wins_usd: avoidedWinsUsd,
    avoided_losses_usd: avoidedLossesUsd,
    pnl_ci_low_usd: ci?.lo ?? null,
    pnl_ci_high_usd: ci?.hi ?? null,
    delta_vs_baseline_pnl_usd: baseline ? pnl - baseline.pnl_usd : 0,
    delta_vs_baseline_brier: baseline ? brier - baseline.brier : 0,
  };
}

function timeBucket(secs: number): "≤30s" | "31-60s" | "61-120s" | ">120s" {
  if (secs <= 30) return "≤30s";
  if (secs <= 60) return "31-60s";
  if (secs <= 120) return "61-120s";
  return ">120s";
}

function runSegmentsWindow(rows: SimRow[], segments: Record<string, SimRow[]>): PolicyResult[] {
  const out: PolicyResult[] = [];
  for (const [segName, segRows] of Object.entries(segments)) {
    const baselineUnits = windowUnits("A_baseline", segRows);
    const baseline = summarize("A_baseline", segName, baselineUnits, undefined, segName === "all");
    out.push(baseline);
    for (const p of POLICIES) {
      if (p === "A_baseline") continue;
      const units = windowUnits(p, segRows);
      out.push(summarize(p, segName, units, { pnl_usd: baseline.pnl_usd, brier: baseline.brier }, segName === "all"));
    }
  }
  return out;
}

export const runJumpPolicyBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fromIso?: string; toIso?: string }) => data)
  .handler(async ({ data, context }) => {
    const toIso = data.toIso ?? new Date().toISOString();
    const fromIso = data.fromIso ?? new Date(Date.now() - 7 * 86400_000).toISOString();

    const { data: rows, error } = await context.supabase
      .from("btc_model_predictions")
      .select("id, ticker, strike, side, model_prob, market_yes_price, edge_pts, spot_at_snapshot, sigma_at_snapshot, snapshot_seconds_to_close, close_time, was_correct, jump_features, outcome")
      .not("outcome", "is", null)
      .gte("close_time", fromIso)
      .lte("close_time", toIso)
      .order("close_time", { ascending: true })
      .limit(5000);
    if (error) throw error;

    const all = rows ?? [];
    const simRows: SimRow[] = [];
    for (const r of all) {
      const jf = (r.jump_features ?? {}) as JF;
      if (!jf.available) continue;
      const side = (r.side as "YES" | "NO");
      const yesPrice = Number(r.market_yes_price);
      const marketAsk = side === "YES" ? yesPrice : 1 - yesPrice;
      if (!(marketAsk > 0 && marketAsk < 1)) continue;
      simRows.push({
        id: r.id as string,
        windowKey: `${r.ticker}|${r.strike}|${r.close_time}`,
        day: (r.close_time as string).slice(0, 10),
        side,
        modelProb: Number(r.model_prob),
        marketAsk,
        edgePts: Number(r.edge_pts),
        spot: Number(r.spot_at_snapshot),
        strike: Number(r.strike),
        sigmaMin: Number(r.sigma_at_snapshot ?? 0),
        secondsToClose: Number(r.snapshot_seconds_to_close ?? 0),
        won: !!r.was_correct,
        jumpRatio: jf.extra?.jumpRatio15s ?? jf.extra?.jumpRatio30s ?? null,
        contested: !!jf.extra?.contested,
        sourceQuality: jf.source_quality === "primary" ? "primary"
          : jf.source_quality === "odds_tape_fallback" ? "odds_tape_fallback"
          : "unknown",
      });
    }

    const segments: Record<string, SimRow[]> = {
      all: simRows,
      "≤30s": simRows.filter(r => timeBucket(r.secondsToClose) === "≤30s"),
      "31-60s": simRows.filter(r => timeBucket(r.secondsToClose) === "31-60s"),
      "61-120s": simRows.filter(r => timeBucket(r.secondsToClose) === "61-120s"),
      contested: simRows.filter(r => r.contested),
      uncontested: simRows.filter(r => !r.contested),
      YES: simRows.filter(r => r.side === "YES"),
      NO: simRows.filter(r => r.side === "NO"),
      "jr<1.0": simRows.filter(r => (r.jumpRatio ?? 0) < 1.0),
      "jr 1.0-1.5": simRows.filter(r => (r.jumpRatio ?? 0) >= 1.0 && (r.jumpRatio ?? 0) < 1.5),
      "jr 1.5-2.0": simRows.filter(r => (r.jumpRatio ?? 0) >= 1.5 && (r.jumpRatio ?? 0) < 2.0),
      "jr>=2.0": simRows.filter(r => (r.jumpRatio ?? 0) >= 2.0),
    };

    // Window-level primary results
    const results = runSegmentsWindow(simRows, segments);

    // Snapshot-level (secondary/correlated view — original semantics)
    const snapshotResults: PolicyResult[] = [];
    for (const [segName, segRows] of Object.entries(segments)) {
      const baseUnits = snapshotUnits("A_baseline", segRows);
      const base = summarize("A_baseline", segName, baseUnits);
      snapshotResults.push(base);
      for (const p of POLICIES) {
        if (p === "A_baseline") continue;
        snapshotResults.push(summarize(p, segName, snapshotUnits(p, segRows), { pnl_usd: base.pnl_usd, brier: base.brier }));
      }
    }

    // 88%+ confidence pocket (window-level). Filter to windows where the
    // baseline's chosen snapshot has model_prob >= 0.88 or <= 0.12.
    const baselineWinUnits = windowUnits("A_baseline", simRows);
    const pocketWindowKeys = new Set(
      baselineWinUnits
        .filter(u => u.accepted && (u.row.modelProb >= JUMP_BT_CONFIG.highConfidenceHi || u.row.modelProb <= JUMP_BT_CONFIG.highConfidenceLo))
        .map(u => u.row.windowKey),
    );
    const pocketRows = simRows.filter(r => pocketWindowKeys.has(r.windowKey));
    const pocket88: PolicyResult[] = [];
    if (pocketRows.length) {
      const baseUnits = windowUnits("A_baseline", pocketRows);
      const base = summarize("A_baseline", "pocket_88", baseUnits, undefined, true);
      pocket88.push(base);
      for (const p of POLICIES) {
        if (p === "A_baseline") continue;
        pocket88.push(summarize(p, "pocket_88", windowUnits(p, pocketRows), { pnl_usd: base.pnl_usd, brier: base.brier }, true));
      }
    }

    // Walk-forward: hold out last N days as "test", earlier as "train".
    const allDays = Array.from(new Set(simRows.map(r => r.day))).sort();
    const holdout = JUMP_BT_CONFIG.walkforwardHoldoutDays;
    const trainDays = allDays.slice(0, Math.max(0, allDays.length - holdout));
    const testDays = allDays.slice(Math.max(0, allDays.length - holdout));
    const trainRows = simRows.filter(r => trainDays.includes(r.day));
    const testRows = simRows.filter(r => testDays.includes(r.day));

    const buildSlice = (label: "train" | "test", days: string[], rowsIn: SimRow[]): WalkForwardSlice => {
      const baseUnits = windowUnits("A_baseline", rowsIn);
      const base = summarize("A_baseline", "all", baseUnits, undefined, true);
      const out: PolicyResult[] = [base];
      for (const p of POLICIES) {
        if (p === "A_baseline") continue;
        out.push(summarize(p, "all", windowUnits(p, rowsIn), { pnl_usd: base.pnl_usd, brier: base.brier }, true));
      }
      return {
        label,
        fromIso: days[0] ? `${days[0]}T00:00:00Z` : fromIso,
        toIso: days[days.length - 1] ? `${days[days.length - 1]}T23:59:59Z` : toIso,
        days,
        results: out,
      };
    };
    const walkForward: WalkForwardSlice[] = [
      buildSlice("train", trainDays, trainRows),
      buildSlice("test", testDays, testRows),
    ];

    // Per-day walk-forward table (window-level).
    const perDay: JumpBacktestResponse["perDay"] = [];
    for (const day of allDays) {
      const dayRows = simRows.filter(r => r.day === day);
      for (const p of POLICIES) {
        const s = summarize(p, day, windowUnits(p, dayRows));
        perDay.push({ day, policy: p, n_trades: s.n_trades, pnl_usd: s.pnl_usd, win_rate: s.win_rate, brier: s.brier });
      }
    }

    // Source-split (window-level, "all" segment): primary vs odds-tape fallback vs combined.
    const primaryRows = simRows.filter(r => r.sourceQuality === "primary");
    const fallbackRows = simRows.filter(r => r.sourceQuality === "odds_tape_fallback");
    const unknownRows = simRows.filter(r => r.sourceQuality === "unknown");
    const buildSourceTable = (label: string, rowsIn: SimRow[]): PolicyResult[] => {
      if (!rowsIn.length) return [];
      const baseUnits = windowUnits("A_baseline", rowsIn);
      const base = summarize("A_baseline", label, baseUnits, undefined, true);
      const out: PolicyResult[] = [base];
      for (const p of POLICIES) {
        if (p === "A_baseline") continue;
        out.push(summarize(p, label, windowUnits(p, rowsIn), { pnl_usd: base.pnl_usd, brier: base.brier }, true));
      }
      return out;
    };
    const sourceSplit = {
      primary: buildSourceTable("primary", primaryRows),
      fallback: buildSourceTable("fallback", fallbackRows),
      combined: buildSourceTable("combined", simRows),
      counts: { primary: primaryRows.length, fallback: fallbackRows.length, unknown: unknownRows.length },
    };

    const windowCount = new Set(simRows.map(r => r.windowKey)).size;
    return {
      totalRows: all.length,
      eligibleRows: simRows.length,
      windows: windowCount,
      fromIso,
      toIso,
      analysisMode: "window",
      results,
      snapshotResults,
      pocket88,
      walkForward,
      sourceSplit,
      perDay,
      foldSplitKey: "ticker|strike|close_time",
    } satisfies JumpBacktestResponse;
  });
