// Phase 1 · Step 4 — Self-learning Platt calibration.
//
// Reads settled rows from btc_model_predictions and fits a logistic
// recalibration  P_calib = σ(a · logit(P_raw) + b)  per time-to-close bucket.
// Activates only once a bucket has ≥ MIN_SAMPLES; otherwise falls back to
// identity so we never degrade the live model on cold start.
//
// Refit cached for 5 minutes. Server-only — never import from a route file.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface BucketFit {
  bucket: string;       // "lt60" | "60_300" | "300_600" | "ge600"
  n: number;
  wins: number;
  hitRate: number;
  meanProb: number;
  brier: number;
  a: number;            // Platt slope
  b: number;            // Platt intercept
  active: boolean;      // applied if n >= MIN_SAMPLES
}

export interface CalibratorState {
  asOf: string;
  totalSettled: number;
  globalHitRate: number;
  globalBrier: number;
  buckets: BucketFit[];
  // Global Platt fit across ALL settled rows — used as a fallback when a
  // per-bucket fit hasn't reached MIN_SAMPLES yet. Activates at GLOBAL_MIN_N
  // so we get calibration benefit on cold start instead of waiting for 400+
  // rows across all four buckets.
  global: { a: number; b: number; n: number; active: boolean };
}

const MIN_SAMPLES = 30;        // per-bucket threshold (was 100)
const GLOBAL_MIN_N = 20;       // global fallback activates at 20 settled rows
const TTL_MS = 5 * 60_000;
const MAX_ROWS = 5000;

const EPS = 1e-6;
const logit = (p: number) => Math.log(Math.max(EPS, p) / Math.max(EPS, 1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function bucketOf(secondsToClose: number): BucketFit["bucket"] {
  if (secondsToClose < 60) return "lt60";
  if (secondsToClose < 300) return "60_300";
  if (secondsToClose < 600) return "300_600";
  return "ge600";
}

interface Sample { p: number; y: 0 | 1; bucket: BucketFit["bucket"]; w: number }

// Recency half-life: a settled row from 7 days ago counts half as much as a
// row settled right now. Keeps the calibrator responsive when market regime
// shifts (e.g. vol regime changes) without throwing away old data entirely.
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

function recencyWeight(settledAt: string | null): number {
  if (!settledAt) return 1;
  const age = Date.now() - new Date(settledAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 1;
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
}

// Fit Platt by weighted Newton-Raphson on (a, b). 30 iters is plenty.
function fitPlatt(samples: Sample[]): { a: number; b: number } {
  if (samples.length === 0) return { a: 1, b: 0 };
  let a = 1, b = 0;
  for (let iter = 0; iter < 30; iter++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const s of samples) {
      const x = logit(s.p);
      const z = a * x + b;
      const p = sigmoid(z);
      const w = p * (1 - p) * s.w;
      const e = (p - s.y) * s.w;
      g0 += e * x; g1 += e;
      h00 += w * x * x; h01 += w * x; h11 += w;
    }
    // Tikhonov regularization to keep things stable on small N.
    h00 += 1e-3; h11 += 1e-3;
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (-h01 * g0 + h00 * g1) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-6) break;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { a: 1, b: 0 };
  a = Math.max(0.2, Math.min(3, a));
  b = Math.max(-2, Math.min(2, b));
  return { a, b };
}

let _cache: { at: number; state: CalibratorState } | null = null;

export async function getCalibrator(): Promise<CalibratorState> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.state;

  const { data, error } = await supabaseAdmin
    .from("btc_model_predictions")
    .select("model_prob, was_correct, side, snapshot_seconds_to_close")
    .not("was_correct", "is", null)
    .order("settled_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error || !data) {
    const empty: CalibratorState = {
      asOf: new Date().toISOString(),
      totalSettled: 0, globalHitRate: 0, globalBrier: 0,
      buckets: [],
      global: { a: 1, b: 0, n: 0, active: false },
    };
    _cache = { at: Date.now(), state: empty };
    return empty;
  }

  // Convert each row to a sample of (model YES prob, YES outcome).
  // The row stores side + was_correct; recover the YES outcome.
  const samples: Sample[] = [];
  for (const r of data) {
    const p = Number(r.model_prob);
    const correct = r.was_correct === true;
    if (!Number.isFinite(p) || p <= 0 || p >= 1) continue;
    const side = (r.side as string) === "YES" ? "YES" : "NO";
    // YES outcome iff (side==YES & correct) OR (side==NO & !correct)
    const yes: 0 | 1 = (side === "YES" ? correct : !correct) ? 1 : 0;
    samples.push({ p, y: yes, bucket: bucketOf(Number(r.snapshot_seconds_to_close ?? 0)) });
  }

  const bucketKeys: BucketFit["bucket"][] = ["lt60", "60_300", "300_600", "ge600"];
  const buckets: BucketFit[] = bucketKeys.map(key => {
    const rows = samples.filter(s => s.bucket === key);
    const n = rows.length;
    const wins = rows.filter(r => r.y === 1).length;
    const meanProb = n ? rows.reduce((a, r) => a + r.p, 0) / n : 0;
    const brier = n ? rows.reduce((a, r) => a + (r.p - r.y) ** 2, 0) / n : 0;
    const { a, b } = fitPlatt(rows);
    return {
      bucket: key, n, wins,
      hitRate: n ? wins / n : 0,
      meanProb, brier, a, b,
      active: n >= MIN_SAMPLES,
    };
  });

  const totalSettled = samples.length;
  const globalHitRate = totalSettled ? samples.filter(s => s.y === 1).length / totalSettled : 0;
  const globalBrier = totalSettled ? samples.reduce((a, s) => a + (s.p - s.y) ** 2, 0) / totalSettled : 0;

  // Global Platt fit across all settled rows — activates much sooner than
  // per-bucket fits and serves as the fallback whenever a bucket is cold.
  const globalFit = fitPlatt(samples);
  const global = {
    a: globalFit.a,
    b: globalFit.b,
    n: totalSettled,
    active: totalSettled >= GLOBAL_MIN_N,
  };

  const state: CalibratorState = {
    asOf: new Date().toISOString(),
    totalSettled, globalHitRate, globalBrier,
    buckets,
    global,
  };
  _cache = { at: Date.now(), state };
  return state;
}

export function applyCalibration(p: number, secondsToClose: number, state: CalibratorState | null): { p: number; deltaPts: number; bucket: string; active: boolean } {
  const bucket = bucketOf(secondsToClose);
  if (p <= 0 || p >= 1 || !state) return { p, deltaPts: 0, bucket, active: false };
  const fit = state.buckets.find(b => b.bucket === bucket);
  // Prefer per-bucket fit when it has enough samples; otherwise fall back to
  // the global fit so calibration kicks in long before any bucket reaches 30.
  if (fit?.active) {
    const x = logit(p);
    const pNew = sigmoid(fit.a * x + fit.b);
    return { p: pNew, deltaPts: (pNew - p) * 100, bucket, active: true };
  }
  if (state.global.active) {
    const x = logit(p);
    const pNew = sigmoid(state.global.a * x + state.global.b);
    return { p: pNew, deltaPts: (pNew - p) * 100, bucket: `${bucket}+global`, active: true };
  }
  return { p, deltaPts: 0, bucket, active: false };
}
