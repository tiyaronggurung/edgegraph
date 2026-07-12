// Out-of-sample isotonic calibration for BTC model probabilities.
// See .lovable/plan.md § Phase 1C.
//
// Uses Pool-Adjacent-Violators (PAV) on side-locked probability. Walk-forward
// split by market window (ticker), never by snapshot. Writes fit pins to
// btc_isotonic_fit for regression tracking; does NOT touch btc_calibration or
// change the applied calibrator. The existing Platt path remains authoritative
// until the ablation report shows isotonic wins two nights in a row.
//
// Server-only.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const EPS = 1e-6;

export interface IsotonicPin { p: number; y: number }
export interface IsotonicFit {
  scope: "global" | "bucket";
  timeBucket: string | null;
  pins: IsotonicPin[];
  nTrain: number;
  nTest: number;
  brierTrain: number | null;
  brierTest: number | null;
  loglossTrain: number | null;
  loglossTest: number | null;
}

interface Row {
  ticker: string;
  sideLockedProb: number;
  y: 0 | 1;
  closeTime: number; // epoch ms
  timeBucket: string | null;
}

/** PAV — Pool-Adjacent-Violators. Input samples pre-sorted by prob asc. */
function pav(samples: { p: number; y: number; w: number }[]): IsotonicPin[] {
  if (samples.length === 0) return [];
  // Blocks of monotonically-non-decreasing means.
  const blocks: { sumWY: number; sumW: number; mean: number; pMax: number }[] = [];
  for (const s of samples) {
    let sumWY = s.w * s.y;
    let sumW = s.w;
    let pMax = s.p;
    while (
      blocks.length > 0 &&
      blocks[blocks.length - 1].mean >= sumWY / sumW
    ) {
      const prev = blocks.pop()!;
      sumWY += prev.sumWY;
      sumW += prev.sumW;
      pMax = Math.max(pMax, prev.pMax);
    }
    blocks.push({ sumWY, sumW, mean: sumWY / sumW, pMax });
  }
  // Pin per block at (pMax, mean).
  return blocks.map(b => ({ p: b.pMax, y: Math.max(EPS, Math.min(1 - EPS, b.mean)) }));
}

/** Predict from a fitted set of pins. Linear interpolation between pins. */
export function isotonicPredict(pins: IsotonicPin[], p: number): number {
  if (!pins.length) return p;
  if (p <= pins[0].p) return pins[0].y;
  if (p >= pins[pins.length - 1].p) return pins[pins.length - 1].y;
  // Binary search
  let lo = 0, hi = pins.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pins[mid].p <= p) lo = mid;
    else hi = mid;
  }
  const a = pins[lo], b = pins[hi];
  const t = (p - a.p) / (b.p - a.p || EPS);
  return a.y + (b.y - a.y) * t;
}

/** Log loss for arrays of (p, y). */
function logLoss(rows: { p: number; y: number }[]): number {
  if (!rows.length) return 0;
  let s = 0;
  for (const r of rows) {
    const p = Math.max(EPS, Math.min(1 - EPS, r.p));
    s += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
  }
  return s / rows.length;
}
function brier(rows: { p: number; y: number }[]): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / rows.length;
}

function fitTimeBucketOf(secs: number | null): string | null {
  if (secs == null || !Number.isFinite(secs)) return null;
  if (secs <= 30) return "30s";
  if (secs <= 60) return "1m";
  if (secs <= 120) return "2m";
  if (secs <= 300) return "5m";
  if (secs <= 600) return "10m";
  return "13m+";
}

/**
 * Load settled predictions and produce a global + per-bucket isotonic fit
 * on a walk-forward split by ticker. The oldest 70% of tickers train, the
 * newest 30% test.
 */
export async function fitIsotonic(): Promise<IsotonicFit[]> {
  const { data, error } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("ticker, side, model_prob, was_correct, close_time, snapshot_seconds_to_close, time_bucket")
    .not("outcome", "is", null)
    .not("model_prob", "is", null)
    .order("close_time", { ascending: true })
    .limit(20000);
  if (error) throw new Error(error.message);

  const rows: Row[] = [];
  for (const r of data ?? []) {
    const p = Number(r.model_prob);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) continue;
    const side = (r.side as string) === "YES" ? "YES" : "NO";
    const won = r.was_correct === true;
    const sideProb = side === "YES" ? p : 1 - p;
    const y: 0 | 1 = won ? 1 : 0;
    rows.push({
      ticker: r.ticker as string,
      sideLockedProb: Math.max(EPS, Math.min(1 - EPS, sideProb)),
      y,
      closeTime: new Date(r.close_time as string).getTime(),
      timeBucket:
        (r.time_bucket as string | null) ??
        fitTimeBucketOf(r.snapshot_seconds_to_close as number | null),
    });
  }
  if (rows.length < 40) return [];

  // Ticker-level walk-forward split. All snapshots of a ticker land in the
  // same fold — no target leakage across snapshots of the same market.
  const tickerFirstClose = new Map<string, number>();
  for (const r of rows) {
    const cur = tickerFirstClose.get(r.ticker);
    if (cur == null || r.closeTime < cur) tickerFirstClose.set(r.ticker, r.closeTime);
  }
  const tickersSorted = [...tickerFirstClose.entries()].sort((a, b) => a[1] - b[1]);
  const cutIdx = Math.floor(tickersSorted.length * 0.7);
  const trainTickers = new Set(tickersSorted.slice(0, cutIdx).map(t => t[0]));

  const train = rows.filter(r => trainTickers.has(r.ticker));
  const test = rows.filter(r => !trainTickers.has(r.ticker));

  const fits: IsotonicFit[] = [];

  // Global fit.
  const globalSamples = train
    .map(r => ({ p: r.sideLockedProb, y: r.y as number, w: 1 }))
    .sort((a, b) => a.p - b.p);
  const globalPins = pav(globalSamples);
  const trainPred = train.map(r => ({ p: isotonicPredict(globalPins, r.sideLockedProb), y: r.y }));
  const testPred = test.map(r => ({ p: isotonicPredict(globalPins, r.sideLockedProb), y: r.y }));
  fits.push({
    scope: "global",
    timeBucket: null,
    pins: globalPins,
    nTrain: train.length,
    nTest: test.length,
    brierTrain: brier(trainPred),
    brierTest: test.length ? brier(testPred) : null,
    loglossTrain: logLoss(trainPred),
    loglossTest: test.length ? logLoss(testPred) : null,
  });

  // Per-time-bucket fits — only when both train and test have ≥ 200 / 30.
  const buckets = new Set(rows.map(r => r.timeBucket).filter((x): x is string => !!x));
  for (const b of buckets) {
    const trB = train.filter(r => r.timeBucket === b);
    const teB = test.filter(r => r.timeBucket === b);
    if (trB.length < 200 || teB.length < 30) continue;
    const samples = trB.map(r => ({ p: r.sideLockedProb, y: r.y as number, w: 1 }))
      .sort((a, b) => a.p - b.p);
    const pins = pav(samples);
    const trP = trB.map(r => ({ p: isotonicPredict(pins, r.sideLockedProb), y: r.y }));
    const teP = teB.map(r => ({ p: isotonicPredict(pins, r.sideLockedProb), y: r.y }));
    fits.push({
      scope: "bucket",
      timeBucket: b,
      pins,
      nTrain: trB.length,
      nTest: teB.length,
      brierTrain: brier(trP),
      brierTest: brier(teP),
      loglossTrain: logLoss(trP),
      loglossTest: logLoss(teP),
    });
  }

  return fits;
}

/**
 * Persist fits to btc_isotonic_fit. One row per fit. Old fits stay for
 * regression tracking — do not truncate.
 */
export async function persistFits(fits: IsotonicFit[], dataCutoff?: string): Promise<number> {
  if (!fits.length) return 0;
  const rows = fits.map(f => ({
    scope: f.scope,
    time_bucket: f.timeBucket,
    pins: f.pins,
    n_train: f.nTrain,
    n_test: f.nTest,
    brier_train: f.brierTrain,
    brier_test: f.brierTest,
    logloss_train: f.loglossTrain,
    logloss_test: f.loglossTest,
    data_cutoff: dataCutoff ?? new Date().toISOString(),
  }));
  const { error } = await supabaseAdmin.from("btc_isotonic_fit").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Load the most recent global + bucket fits. Latest per (scope, time_bucket). */
export async function loadLatestFits(): Promise<IsotonicFit[]> {
  const { data, error } = await supabaseAdmin
    .from("btc_isotonic_fit")
    .select("scope, time_bucket, pins, n_train, n_test, brier_train, brier_test, logloss_train, logloss_test, fitted_at")
    .order("fitted_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  const seen = new Set<string>();
  const out: IsotonicFit[] = [];
  for (const r of data) {
    const key = `${r.scope}|${r.time_bucket ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      scope: r.scope as "global" | "bucket",
      timeBucket: (r.time_bucket as string | null) ?? null,
      pins: (r.pins as IsotonicPin[]) ?? [],
      nTrain: Number(r.n_train ?? 0),
      nTest: Number(r.n_test ?? 0),
      brierTrain: r.brier_train != null ? Number(r.brier_train) : null,
      brierTest: r.brier_test != null ? Number(r.brier_test) : null,
      loglossTrain: r.logloss_train != null ? Number(r.logloss_train) : null,
      loglossTest: r.logloss_test != null ? Number(r.logloss_test) : null,
    });
  }
  return out;
}
