// Phase 1 · Read-only ablation report.
// Compares model variants on unseen settled BTC 15m windows and reports each
// variant's Brier, log loss, hit rate, calibration by prob band, breakdowns
// by time bucket / sigma-distance / side, and $10-flat realized P/L.
//
// Zero writes, zero decision impact. Handler body is stripped from the client
// bundle; the .server helpers stay server-only.
import { createServerFn } from "@tanstack/react-start";

export interface AblationVariantRow {
  key: string;
  label: string;
  nEligible: number;
  brier: number;
  logLoss: number;
  hitRate: number;
  avgPredicted: number;
  pnlUsd: number;              // $10-flat P/L using actual entry ask
  maxDrawdownUsd: number;      // running-min of cumulative P/L
  calibration: Array<{ band: string; n: number; predicted: number; actual: number }>;
  byTime: Array<{ key: string; n: number; brier: number; hitRate: number }>;
  bySigma: Array<{ key: string; n: number; brier: number; hitRate: number }>;
  bySide: Array<{ key: string; n: number; brier: number; hitRate: number }>;
}

export interface AblationResult {
  windowCount: number;
  trainCount: number;
  testCount: number;
  variants: AblationVariantRow[];
  isotonicFits: Array<{
    scope: "global" | "bucket";
    timeBucket: string | null;
    nTrain: number;
    nTest: number;
    brierTest: number | null;
    loglossTest: number | null;
  }>;
}

const EPS = 1e-6;

function sigmaBucket(sigDist: number | null): string {
  if (sigDist == null || !Number.isFinite(sigDist)) return "unknown";
  if (sigDist < 0.5) return "0-0.5σ";
  if (sigDist < 1.0) return "0.5-1σ";
  if (sigDist < 2.0) return "1-2σ";
  if (sigDist < 3.0) return "2-3σ";
  return "3σ+";
}
function timeBucketOf(secs: number | null): string {
  if (secs == null || !Number.isFinite(secs)) return "unknown";
  if (secs <= 30) return "30s";
  if (secs <= 60) return "1m";
  if (secs <= 120) return "2m";
  if (secs <= 300) return "5m";
  if (secs <= 600) return "10m";
  return "13m+";
}
function sigDistFrom(row: {
  spot_at_snapshot: number | string | null;
  strike: number | string | null;
  sigma_at_snapshot: number | string | null;
  snapshot_seconds_to_close: number | null;
}): number | null {
  const spot = Number(row.spot_at_snapshot);
  const strike = Number(row.strike);
  const sigma = Number(row.sigma_at_snapshot);
  const secs = Number(row.snapshot_seconds_to_close);
  if (!spot || !strike || !sigma || sigma <= 0 || !secs) return null;
  const stdMoveUsd = (sigma / 100) * Math.sqrt(secs / 60) * spot;
  if (stdMoveUsd <= 0) return null;
  return Math.abs(spot - strike) / stdMoveUsd;
}

interface EnrichedRow {
  ticker: string;
  side: "YES" | "NO";
  y: 0 | 1;
  ask: number;
  physics: number | null;      // side-locked
  independent: number | null;  // side-locked
  model: number;               // side-locked (existing model_prob)
  theory: number | null;       // side-locked
  timeBucket: string;
  sigmaBucket: string;
  closeMs: number;
}

/** Compute metrics for a variant with side-locked prob per row. */
function summarize(
  key: string,
  label: string,
  rows: EnrichedRow[],
  probOf: (r: EnrichedRow) => number | null,
): AblationVariantRow {
  const filtered = rows
    .map(r => ({ r, p: probOf(r) }))
    .filter((x): x is { r: EnrichedRow; p: number } => x.p != null && Number.isFinite(x.p));
  const n = filtered.length;
  if (n === 0) {
    return {
      key, label, nEligible: 0,
      brier: 0, logLoss: 0, hitRate: 0, avgPredicted: 0,
      pnlUsd: 0, maxDrawdownUsd: 0,
      calibration: [], byTime: [], bySigma: [], bySide: [],
    };
  }
  let wins = 0, brierSum = 0, llSum = 0, pSum = 0, pnl = 0;
  let runningMin = 0, runningPnl = 0, maxDrawdown = 0;
  const bands = [
    { name: "0-20", lo: 0, hi: 0.2 },
    { name: "20-40", lo: 0.2, hi: 0.4 },
    { name: "40-60", lo: 0.4, hi: 0.6 },
    { name: "60-80", lo: 0.6, hi: 0.8 },
    { name: "80-100", lo: 0.8, hi: 1.0001 },
  ];
  const bandStats = bands.map(b => ({ ...b, n: 0, pSum: 0, wins: 0 }));
  const byTimeMap = new Map<string, { n: number; brier: number; wins: number }>();
  const bySigmaMap = new Map<string, { n: number; brier: number; wins: number }>();
  const bySideMap = new Map<string, { n: number; brier: number; wins: number }>();

  for (const { r, p } of filtered) {
    const pp = Math.max(EPS, Math.min(1 - EPS, p));
    const y = r.y;
    if (y) wins += 1;
    brierSum += (pp - y) ** 2;
    llSum += -(y * Math.log(pp) + (1 - y) * Math.log(1 - pp));
    pSum += pp;
    // $10-flat P/L on actual entry ask (only counted when we'd take the bet;
    // for ablation we count every row so variants are compared on the same set)
    const ask = r.ask;
    const trade = Number.isFinite(ask) && ask > 0 && ask < 1;
    if (trade) {
      const rowPnl = y ? 10 * (1 - ask) / ask : -10;
      pnl += rowPnl;
      runningPnl += rowPnl;
      if (runningPnl > runningMin) runningMin = runningPnl;
      const dd = runningPnl - runningMin;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
    for (const b of bandStats) if (pp >= b.lo && pp < b.hi) { b.n += 1; b.pSum += pp; if (y) b.wins += 1; break; }
    const pushInto = (m: Map<string, { n: number; brier: number; wins: number }>, k: string) => {
      const g = m.get(k) ?? { n: 0, brier: 0, wins: 0 };
      g.n += 1; g.brier += (pp - y) ** 2; if (y) g.wins += 1;
      m.set(k, g);
    };
    pushInto(byTimeMap, r.timeBucket);
    pushInto(bySigmaMap, r.sigmaBucket);
    pushInto(bySideMap, r.side);
  }
  const asRows = (m: Map<string, { n: number; brier: number; wins: number }>) =>
    [...m.entries()]
      .map(([k, g]) => ({ key: k, n: g.n, brier: g.brier / g.n, hitRate: g.wins / g.n }))
      .sort((a, b) => b.n - a.n);
  return {
    key, label,
    nEligible: n,
    brier: brierSum / n,
    logLoss: llSum / n,
    hitRate: wins / n,
    avgPredicted: pSum / n,
    pnlUsd: pnl,
    maxDrawdownUsd: maxDrawdown,
    calibration: bandStats.map(b => ({
      band: b.name, n: b.n,
      predicted: b.n > 0 ? b.pSum / b.n : 0,
      actual: b.n > 0 ? b.wins / b.n : 0,
    })),
    byTime: asRows(byTimeMap),
    bySigma: asRows(bySigmaMap),
    bySide: asRows(bySideMap),
  };
}

export const getModelAblation = createServerFn({ method: "GET" }).handler(
  async (): Promise<AblationResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadLatestFits, isotonicPredict } = await import("@/lib/cryptoIsotonic.server");

    const { data, error } = await supabaseAdmin
      .from("btc_model_predictions")
      .select("ticker, side, was_correct, model_prob, market_yes_price, theory_yes_prob, physics_prob, independent_prob, spot_at_snapshot, strike, sigma_at_snapshot, snapshot_seconds_to_close, time_bucket, close_time")
      .not("outcome", "is", null)
      .not("model_prob", "is", null)
      .order("close_time", { ascending: true })
      .limit(20000);
    if (error) throw new Error(error.message);

    const all = (data ?? [])
      .filter(r => r.model_prob != null && r.was_correct != null)
      .map(r => {
        const side = (r.side as string) === "YES" ? "YES" : "NO";
        const model = Number(r.model_prob);
        const market = Number(r.market_yes_price);
        const theory = r.theory_yes_prob != null ? Number(r.theory_yes_prob) : null;
        const physics = r.physics_prob != null ? Number(r.physics_prob) : null;
        const independent = r.independent_prob != null ? Number(r.independent_prob) : null;
        const asYes = (v: number | null) => v == null ? null : (side === "YES" ? v : 1 - v);
        return {
          ticker: r.ticker as string,
          side: side as "YES" | "NO",
          y: (r.was_correct ? 1 : 0) as 0 | 1,
          ask: side === "YES" ? market : 1 - market,
          physics: asYes(physics),
          independent: asYes(independent),
          model: (side === "YES" ? model : 1 - model),
          theory: asYes(theory),
          timeBucket: (r.time_bucket as string) ?? timeBucketOf(r.snapshot_seconds_to_close as number | null),
          sigmaBucket: sigmaBucket(sigDistFrom(r as unknown as Parameters<typeof sigDistFrom>[0])),
          closeMs: new Date(r.close_time as string).getTime(),
        } as EnrichedRow;
      });

    if (all.length === 0) {
      return { windowCount: 0, trainCount: 0, testCount: 0, variants: [], isotonicFits: [] };
    }

    // Walk-forward split by ticker: oldest 70% train, newest 30% test.
    const firstClose = new Map<string, number>();
    for (const r of all) {
      const cur = firstClose.get(r.ticker);
      if (cur == null || r.closeMs < cur) firstClose.set(r.ticker, r.closeMs);
    }
    const tickersSorted = [...firstClose.entries()].sort((a, b) => a[1] - b[1]);
    const cutIdx = Math.floor(tickersSorted.length * 0.7);
    const trainTickers = new Set(tickersSorted.slice(0, cutIdx).map(t => t[0]));
    const test = all.filter(r => !trainTickers.has(r.ticker));
    const trainCount = all.length - test.length;

    const fits = await loadLatestFits();
    const globalFit = fits.find(f => f.scope === "global");

    const applyIsotonic = (p: number | null): number | null => {
      if (p == null || !globalFit) return p;
      return isotonicPredict(globalFit.pins, p);
    };

    const variants: AblationVariantRow[] = [
      summarize("physics", "Physics only (diffusion + drift)", test, r => r.physics),
      summarize("theory", "Physics + options (theory)", test, r => r.theory),
      summarize("independent", "Independent (physics + options + micro)", test, r => r.independent),
      summarize("model", "Full model (with market blend + Platt)", test, r => r.model),
      summarize("isotonic", "Independent + isotonic calibration", test, r => applyIsotonic(r.independent)),
      summarize("model_isotonic", "Full model + isotonic recalibration", test, r => applyIsotonic(r.model)),
    ];

    return {
      windowCount: firstClose.size,
      trainCount,
      testCount: test.length,
      variants,
      isotonicFits: fits.map(f => ({
        scope: f.scope,
        timeBucket: f.timeBucket,
        nTrain: f.nTrain,
        nTest: f.nTest,
        brierTest: f.brierTest,
        loglossTest: f.loglossTest,
      })),
    };
  },
);
