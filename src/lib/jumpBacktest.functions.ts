// Five-policy jump-detection backtest. Reads settled btc_model_predictions
// rows that carry jump_features and simulates each policy vs the baseline.
// Read-only. No effect on live gates, stakes, or exits.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- Configurable thresholds (not gate values — analysis knobs) ----
export const JUMP_BT_CONFIG = {
  // Threshold for policies B and E "active jump"
  jumpRatioActiveThreshold: 1.5,
  // Policy C compression rate
  compressionK: 0.35,
  // Policy E additional edge in cents (pts) required during active jumps
  extraEdgePtsWhenJumping: 5,
  // Policy D sigma inflation piecewise (jumpRatio → σ multiplier)
  sigmaLadder: [
    { minJr: 0.0, maxJr: 1.0, mult: 1.00 },
    { minJr: 1.0, maxJr: 1.5, mult: 1.25 }, // linear interp handled below
    { minJr: 1.5, maxJr: 2.0, mult: 1.60 },
    { minJr: 2.0, maxJr: 999, mult: 2.00 },
  ],
  // Simulated stake per accepted trade
  stakeUsd: 100,
} as const;

type Policy = "A_baseline" | "B_skip_active" | "C_compress" | "D_sigma_inflate" | "E_larger_edge";

export interface PolicyResult {
  policy: Policy;
  segment: string;
  n_predictions: number;
  n_trades: number;
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
  delta_vs_baseline_pnl_usd: number;
  delta_vs_baseline_brier: number;
}

export interface JumpBacktestResponse {
  totalRows: number;
  eligibleRows: number;
  windows: number;
  fromIso: string;
  toIso: string;
  results: PolicyResult[];
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

// -------- Feature extraction from stored jump_features json --------
interface JF {
  available?: boolean;
  extra?: {
    jumpRatio15s?: number | null;
    jumpRatio30s?: number | null;
    contested?: boolean;
    sideMovementBps?: number | null;
  };
}

interface SimRow {
  id: string;
  windowKey: string;
  day: string;
  side: "YES" | "NO";
  modelProb: number;
  marketAsk: number;   // yes-price if side=YES, else 1-yes for NO
  edgePts: number;
  spot: number;
  strike: number;
  sigmaMin: number;
  secondsToClose: number;
  won: boolean;
  jumpRatio: number | null;
  contested: boolean;
}

// Apply one policy → returns { accept, effectiveProb }
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

// -------- Metric aggregation --------
function summarizePolicy(policy: Policy, segment: string, rows: SimRow[], baselinePnl?: number, baselineBrier?: number): PolicyResult {
  let n_pred = 0, n_trades = 0, wins = 0, losses = 0;
  let brierSum = 0, brierN = 0;
  let logLossSum = 0;
  let edgeSum = 0;
  let pnl = 0;
  let peak = 0, dd = 0, streak = 0, worstStreak = 0;
  let avoidedWins = 0, avoidedLosses = 0;

  for (const r of rows) {
    n_pred++;
    const { accept, prob } = applyPolicy(policy, r);
    const y = r.won ? 1 : 0;
    brierSum += (prob - y) ** 2;
    brierN++;
    logLossSum += -(y * Math.log(Math.max(1e-6, prob)) + (1 - y) * Math.log(Math.max(1e-6, 1 - prob)));

    if (!accept) {
      if (r.won) avoidedWins++; else avoidedLosses++;
      continue;
    }
    n_trades++;
    edgeSum += (prob - r.marketAsk) * 100;
    // Kalshi-style payoff: pay marketAsk out of $1, receive $1 if won.
    const stake = JUMP_BT_CONFIG.stakeUsd;
    const contracts = stake / Math.max(0.01, r.marketAsk);
    const gross = r.won ? contracts * 1 : 0;
    const pnlDelta = gross - stake;
    pnl += pnlDelta;
    if (pnl > peak) peak = pnl;
    if (peak - pnl > dd) dd = peak - pnl;
    if (r.won) { wins++; streak = 0; } else { losses++; streak++; if (streak > worstStreak) worstStreak = streak; }
  }

  const brier = brierN ? brierSum / brierN : 0;
  const logLoss = brierN ? logLossSum / brierN : 0;
  // ECE — 10 equal-width bins on model prob for accepted trades
  const bins: { sumP: number; sumY: number; n: number }[] = Array.from({ length: 10 }, () => ({ sumP: 0, sumY: 0, n: 0 }));
  for (const r of rows) {
    const { accept, prob } = applyPolicy(policy, r);
    if (!accept) continue;
    const bi = Math.min(9, Math.max(0, Math.floor(prob * 10)));
    bins[bi].sumP += prob;
    bins[bi].sumY += r.won ? 1 : 0;
    bins[bi].n++;
  }
  const total = bins.reduce((s, b) => s + b.n, 0) || 1;
  const ece = bins.reduce((s, b) => b.n > 0 ? s + (b.n / total) * Math.abs(b.sumP / b.n - b.sumY / b.n) : s, 0);

  return {
    policy,
    segment,
    n_predictions: n_pred,
    n_trades,
    wins,
    losses,
    win_rate: n_trades ? wins / n_trades : 0,
    brier,
    log_loss: logLoss,
    ece,
    mean_signed_edge_pts: n_trades ? edgeSum / n_trades : 0,
    pnl_usd: pnl,
    roc_pct: n_trades ? pnl / (n_trades * JUMP_BT_CONFIG.stakeUsd) : 0,
    max_drawdown_usd: dd,
    worst_losing_streak: worstStreak,
    avoided_wins: avoidedWins,
    avoided_losses: avoidedLosses,
    delta_vs_baseline_pnl_usd: baselinePnl != null ? pnl - baselinePnl : 0,
    delta_vs_baseline_brier: baselineBrier != null ? brier - baselineBrier : 0,
  };
}

// -------- Segmentation --------
function timeBucket(secs: number): "≤30s" | "31-60s" | "61-120s" | ">120s" {
  if (secs <= 30) return "≤30s";
  if (secs <= 60) return "31-60s";
  if (secs <= 120) return "61-120s";
  return ">120s";
}

const POLICIES: Policy[] = ["A_baseline", "B_skip_active", "C_compress", "D_sigma_inflate", "E_larger_edge"];

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
      });
    }

    // Segments
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

    const results: PolicyResult[] = [];
    for (const [segName, segRows] of Object.entries(segments)) {
      const baseline = summarizePolicy("A_baseline", segName, segRows);
      results.push(baseline);
      for (const p of POLICIES) {
        if (p === "A_baseline") continue;
        results.push(summarizePolicy(p, segName, segRows, baseline.pnl_usd, baseline.brier));
      }
    }

    // Per-day breakdown for walk-forward inspection (group by window)
    const perDay: JumpBacktestResponse["perDay"] = [];
    const days = Array.from(new Set(simRows.map(r => r.day))).sort();
    for (const day of days) {
      const dayRows = simRows.filter(r => r.day === day);
      for (const p of POLICIES) {
        const s = summarizePolicy(p, day, dayRows);
        perDay.push({ day, policy: p, n_trades: s.n_trades, pnl_usd: s.pnl_usd, win_rate: s.win_rate, brier: s.brier });
      }
    }

    const windowCount = new Set(simRows.map(r => r.windowKey)).size;
    return {
      totalRows: all.length,
      eligibleRows: simRows.length,
      windows: windowCount,
      fromIso,
      toIso,
      results,
      perDay,
      foldSplitKey: "ticker|strike|close_time",
    } satisfies JumpBacktestResponse;
  });
