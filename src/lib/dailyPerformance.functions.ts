// Read-only daily performance report. Aggregates accepted (settled) model
// predictions from btc_model_predictions and skipped trades from
// auto_trade_skip_log for a user-selected window. No writes, no decision
// impact. Handler body is stripped from client bundles.
import { createServerFn } from "@tanstack/react-start";

export type PerfRange = "today" | "7d" | "30d" | "custom";

export interface PerfInput {
  range: PerfRange;
  from?: string; // ISO, only used when range = "custom"
  to?: string;   // ISO
}

export interface PerfBucketRow {
  key: string;
  n: number;
  wins: number;
  hitRate: number;
  avgAsk: number | null;
  avgEdgePts: number | null;
  brier: number;
  evUsd: number;      // sum of $10-flat expected value = 10 * (p_side - ask)/ask when won else ...
  pnlUsd: number;     // realized $10-flat P/L on accepted trades
}

export interface PerfSkipRow {
  reason: string;
  n: number;
  settled: number;      // how many have would_have_won filled
  wouldHaveWon: number; // of those settled
  counterfactualPnl: number; // $10-flat P/L if we had taken them
}

export interface DailyPerfResult {
  windowStart: string;
  windowEnd: string;
  accepted: {
    n: number;
    wins: number;
    hitRate: number;
    brier: number;
    avgAsk: number | null;
    avgEdgePts: number | null;
    pnlUsd: number;   // realized $10 flat
  };
  skipped: {
    n: number;
    settled: number;
    wouldHaveWon: number;
    counterfactualPnl: number;
  };
  byConfidence: PerfBucketRow[];
  byTime: PerfBucketRow[];
  bySigma: PerfBucketRow[];
  bySide: PerfBucketRow[];
  skipReasons: PerfSkipRow[];
}

function resolveWindow(input: PerfInput): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  if (input.range === "today") {
    from.setUTCHours(0, 0, 0, 0);
  } else if (input.range === "7d") {
    from.setUTCDate(from.getUTCDate() - 7);
  } else if (input.range === "30d") {
    from.setUTCDate(from.getUTCDate() - 30);
  } else {
    if (input.from) from.setTime(new Date(input.from).getTime());
    else from.setUTCDate(from.getUTCDate() - 7);
    if (input.to) to.setTime(new Date(input.to).getTime());
  }
  return { from, to };
}

function sigmaBucket(sigDist: number | null): string {
  if (sigDist == null || !Number.isFinite(sigDist)) return "unknown";
  if (sigDist < 0.5) return "0-0.5σ";
  if (sigDist < 1.0) return "0.5-1σ";
  if (sigDist < 2.0) return "1-2σ";
  if (sigDist < 3.0) return "2-3σ";
  return "3σ+";
}
function confBucket(p: number): string {
  if (p < 0.6) return "<60%";
  if (p < 0.7) return "60-70%";
  if (p < 0.8) return "70-80%";
  if (p < 0.88) return "80-88%";
  if (p < 0.95) return "88-95%";
  return "95%+";
}
function timeBucketSecs(secs: number | null): string {
  if (secs == null || !Number.isFinite(secs)) return "unknown";
  if (secs <= 30) return "≤30s";
  if (secs <= 60) return "30-60s";
  if (secs <= 120) return "60-120s";
  return ">120s";
}
function sigDistFrom(r: {
  spot_at_snapshot: number | string | null;
  strike: number | string | null;
  sigma_at_snapshot: number | string | null;
  snapshot_seconds_to_close: number | null;
}): number | null {
  const spot = Number(r.spot_at_snapshot);
  const strike = Number(r.strike);
  const sigma = Number(r.sigma_at_snapshot);
  const secs = Number(r.snapshot_seconds_to_close);
  if (!spot || !strike || !sigma || sigma <= 0 || !secs) return null;
  const stdMoveUsd = (sigma / 100) * Math.sqrt(secs / 60) * spot;
  if (stdMoveUsd <= 0) return null;
  return Math.abs(spot - strike) / stdMoveUsd;
}

// $10-flat realized P/L: win = 10*(1-ask)/ask, loss = -10.
function pnlOn(ask: number, won: boolean): number {
  if (!Number.isFinite(ask) || ask <= 0 || ask >= 1) return won ? 0 : -10;
  return won ? 10 * (1 - ask) / ask : -10;
}

export const getDailyPerformance = createServerFn({ method: "GET" })
  .inputValidator((data: PerfInput) => data)
  .handler(async ({ data }): Promise<DailyPerfResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { from, to } = resolveWindow(data);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // Accepted: predictions settled within window
    const { data: predRows, error: predErr } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("side, model_prob, market_yes_price, edge_pts, was_correct, time_bucket, sigma_at_snapshot, spot_at_snapshot, strike, snapshot_seconds_to_close, settled_at")
      .not("outcome", "is", null)
      .gte("settled_at", fromIso)
      .lte("settled_at", toIso)
      .limit(20000);
    if (predErr) throw new Error(predErr.message);

    // Skipped: skip log created within window
    const { data: skipRows, error: skipErr } = await supabaseAdmin
      .from("auto_trade_skip_log")
      .select("skip_reason, ask_price, would_have_won, would_have_pnl, model_prob, side, sigma_distance, seconds_to_close, created_at")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(20000);
    if (skipErr) throw new Error(skipErr.message);

    const preds = (predRows ?? []).filter(r => r.model_prob != null && r.was_correct != null);

    // Side-locked prob, ask, and $10 P/L for each accepted trade.
    type EnrichedPred = {
      sideProb: number; ask: number; won: boolean;
      confKey: string; timeKey: string; sigmaKey: string; sideKey: string;
      edgePts: number | null;
    };
    const enriched: EnrichedPred[] = preds.map(r => {
      const side = r.side as "YES" | "NO";
      const sideProb = side === "YES" ? Number(r.model_prob) : 1 - Number(r.model_prob);
      const ask = side === "YES" ? Number(r.market_yes_price) : 1 - Number(r.market_yes_price);
      const won = !!r.was_correct;
      return {
        sideProb, ask, won,
        confKey: confBucket(sideProb),
        timeKey: (r.time_bucket as string) ?? timeBucketSecs(r.snapshot_seconds_to_close as number | null),
        sigmaKey: sigmaBucket(sigDistFrom(r as unknown as Parameters<typeof sigDistFrom>[0])),
        sideKey: side,
        edgePts: r.edge_pts != null ? Number(r.edge_pts) : null,
      };
    });

    const n = enriched.length;
    let wins = 0, brierSum = 0, askSum = 0, askN = 0, edgeSum = 0, edgeN = 0, pnl = 0;
    for (const e of enriched) {
      if (e.won) wins += 1;
      const p = Math.max(1e-6, Math.min(1 - 1e-6, e.sideProb));
      brierSum += (p - (e.won ? 1 : 0)) ** 2;
      if (Number.isFinite(e.ask)) { askSum += e.ask; askN += 1; }
      if (e.edgePts != null) { edgeSum += e.edgePts; edgeN += 1; }
      pnl += pnlOn(e.ask, e.won);
    }

    // Generic breakdown helper.
    const build = (keyOf: (e: EnrichedPred) => string): PerfBucketRow[] => {
      const m = new Map<string, { n: number; wins: number; brier: number; askSum: number; askN: number; edgeSum: number; edgeN: number; pnl: number; evSum: number }>();
      for (const e of enriched) {
        const k = keyOf(e);
        const g = m.get(k) ?? { n: 0, wins: 0, brier: 0, askSum: 0, askN: 0, edgeSum: 0, edgeN: 0, pnl: 0, evSum: 0 };
        const p = Math.max(1e-6, Math.min(1 - 1e-6, e.sideProb));
        g.n += 1;
        if (e.won) g.wins += 1;
        g.brier += (p - (e.won ? 1 : 0)) ** 2;
        if (Number.isFinite(e.ask)) { g.askSum += e.ask; g.askN += 1; }
        if (e.edgePts != null) { g.edgeSum += e.edgePts; g.edgeN += 1; }
        g.pnl += pnlOn(e.ask, e.won);
        // EV per $10: 10 * (p*(1-ask)/ask - (1-p))
        if (Number.isFinite(e.ask) && e.ask > 0 && e.ask < 1) {
          g.evSum += 10 * (p * (1 - e.ask) / e.ask - (1 - p));
        }
        m.set(k, g);
      }
      return [...m.entries()]
        .map(([key, g]) => ({
          key, n: g.n, wins: g.wins,
          hitRate: g.n > 0 ? g.wins / g.n : 0,
          avgAsk: g.askN > 0 ? g.askSum / g.askN : null,
          avgEdgePts: g.edgeN > 0 ? g.edgeSum / g.edgeN : null,
          brier: g.n > 0 ? g.brier / g.n : 0,
          evUsd: g.evSum,
          pnlUsd: g.pnl,
        }))
        .sort((a, b) => b.n - a.n);
    };

    const byConfidence = build(e => e.confKey);
    const byTime = build(e => e.timeKey);
    const bySigma = build(e => e.sigmaKey);
    const bySide = build(e => e.sideKey);

    // Skip reasons
    const skipMap = new Map<string, { n: number; settled: number; won: number; pnl: number }>();
    let skippedTotal = 0, skippedSettled = 0, skippedWon = 0, skippedPnl = 0;
    for (const r of skipRows ?? []) {
      skippedTotal += 1;
      // Normalize skip reason to its short prefix ("conf", "edge", "sigzone", etc.)
      const raw = (r.skip_reason as string) ?? "unknown";
      const short = raw.split(":")[0]?.trim() || raw;
      const g = skipMap.get(short) ?? { n: 0, settled: 0, won: 0, pnl: 0 };
      g.n += 1;
      if (r.would_have_won != null) {
        g.settled += 1;
        skippedSettled += 1;
        if (r.would_have_won) { g.won += 1; skippedWon += 1; }
        if (r.would_have_pnl != null) {
          const p = Number(r.would_have_pnl);
          g.pnl += p; skippedPnl += p;
        }
      }
      skipMap.set(short, g);
    }
    const skipReasons: PerfSkipRow[] = [...skipMap.entries()]
      .map(([reason, g]) => ({
        reason, n: g.n, settled: g.settled, wouldHaveWon: g.won, counterfactualPnl: g.pnl,
      }))
      .sort((a, b) => b.n - a.n);

    return {
      windowStart: fromIso,
      windowEnd: toIso,
      accepted: {
        n, wins,
        hitRate: n > 0 ? wins / n : 0,
        brier: n > 0 ? brierSum / n : 0,
        avgAsk: askN > 0 ? askSum / askN : null,
        avgEdgePts: edgeN > 0 ? edgeSum / edgeN : null,
        pnlUsd: pnl,
      },
      skipped: {
        n: skippedTotal,
        settled: skippedSettled,
        wouldHaveWon: skippedWon,
        counterfactualPnl: skippedPnl,
      },
      byConfidence, byTime, bySigma, bySide, skipReasons,
    };
  });
