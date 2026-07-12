// Pure jump-detection features. No I/O. Given a rolling buffer of 1s spot
// samples for the last 30s (index 0 = oldest, last = newest), plus the
// selected strike/side and per-minute σ used by the diffusion model, compute
// the feature vector defined in .lovable/plan.md § Phase 1A.
//
// Consumers store this JSON on the prediction snapshot for later backtesting
// (Phase 1B — no decision impact yet).

export interface JumpFeatures {
  n: number;                        // samples used
  ret5s: number | null;             // signed pct
  ret10s: number | null;
  ret15s: number | null;
  ret30s: number | null;
  move30sBps: number | null;        // |Δspot in 30s| in bps
  expectedMove30sBps: number | null;// σ_perMin * sqrt(0.5) * 1e4
  jumpRatio: number | null;         // move30sBps / expectedMove30sBps
  velocityTowardStrikeBpsPerS: number | null; // + toward strike, − away
  acceleration: number | null;      // ret15s_now − ret15s_prev (signed pct)
  max1sMoveBps: number | null;      // largest single-tick |ret|
  max5sMoveBps: number | null;      // largest 5s window |ret|
  strikeCrossings: number;          // # times spot crossed strike in the buffer
  volExpanding: boolean;            // recent 15s Sd > prior 15s Sd * 1.25
  signedMoveTowardSide: number | null; // +bps = helps selected side, − hurts
}

export interface JumpInput {
  /** Oldest first, newest last. Ideally ~1 sample/sec covering last 30s. */
  spots: number[];
  strike: number;
  side: "YES" | "NO";
  /** Per-minute realized σ in percent (e.g. 0.15 = 0.15%/min). */
  sigmaMinPct: number;
}

const EMPTY: JumpFeatures = {
  n: 0,
  ret5s: null, ret10s: null, ret15s: null, ret30s: null,
  move30sBps: null, expectedMove30sBps: null, jumpRatio: null,
  velocityTowardStrikeBpsPerS: null, acceleration: null,
  max1sMoveBps: null, max5sMoveBps: null,
  strikeCrossings: 0, volExpanding: false, signedMoveTowardSide: null,
};

/**
 * Compute jump features. Robust to short buffers — returns nulls per-field
 * when the buffer is too small rather than throwing. Caller decides whether
 * to persist the row when `n` is below their comfort threshold.
 */
export function computeJumpFeatures(input: JumpInput): JumpFeatures {
  const { spots, strike, side, sigmaMinPct } = input;
  const n = spots.length;
  if (n < 2 || !(strike > 0)) return { ...EMPTY, n };

  const last = spots[n - 1];
  const at = (secondsAgo: number): number | null => {
    // Assume ~1 sample/sec (index-based). If sparser, this is best-effort.
    const idx = n - 1 - secondsAgo;
    if (idx < 0 || idx >= n) return null;
    const v = spots[idx];
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const retTo = (secondsAgo: number): number | null => {
    const from = at(secondsAgo);
    if (from == null) return null;
    return (last - from) / from;
  };

  const ret5s = retTo(5);
  const ret10s = retTo(10);
  const ret15s = retTo(15);
  const ret30s = retTo(30);

  const from30 = at(30);
  const move30sBps = from30 != null ? Math.abs(last - from30) / from30 * 1e4 : null;
  const expectedMove30sBps =
    Number.isFinite(sigmaMinPct) && sigmaMinPct > 0
      ? sigmaMinPct * Math.sqrt(0.5) * 1e2 // σ%/min * sqrt(0.5min) → % → *100 → bps? no: sigmaMinPct is %; bps = 100 * %
      : null;
  // Fix: sigmaMinPct is already in "percent per minute" (e.g. 0.15). One σ in
  // 30s = sigmaMinPct * sqrt(0.5) in percent. Convert percent → bps by *100.
  const expectedMove30sBpsCorrected =
    Number.isFinite(sigmaMinPct) && sigmaMinPct > 0
      ? sigmaMinPct * Math.sqrt(0.5) * 100
      : null;
  const jumpRatio =
    move30sBps != null && expectedMove30sBpsCorrected != null && expectedMove30sBpsCorrected > 0
      ? move30sBps / expectedMove30sBpsCorrected
      : null;

  // Velocity toward strike: signed bps/s. If price is below strike and rising
  // toward it, that's positive velocity toward strike.
  let velocityTowardStrikeBpsPerS: number | null = null;
  if (from30 != null) {
    const dTowardStrike = Math.abs(last - strike) - Math.abs(from30 - strike);
    // Positive when |spot-strike| shrank → moved toward strike.
    velocityTowardStrikeBpsPerS = (-dTowardStrike / from30) * 1e4 / 30;
  }

  // Acceleration: ret over last 15s minus ret over the 15s before that.
  let acceleration: number | null = null;
  const at15 = at(15);
  const at30 = at(30);
  if (at15 != null && at30 != null) {
    const retNow = (last - at15) / at15;
    const retPrev = (at15 - at30) / at30;
    acceleration = retNow - retPrev;
  }

  // Max 1s and 5s move magnitude across the last 30s.
  let max1sMoveBps = 0, max5sMoveBps = 0;
  const start1 = Math.max(1, n - 30);
  for (let i = start1; i < n; i++) {
    const a = spots[i - 1], b = spots[i];
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      const r = Math.abs(b - a) / a * 1e4;
      if (r > max1sMoveBps) max1sMoveBps = r;
    }
  }
  const start5 = Math.max(5, n - 30);
  for (let i = start5; i < n; i++) {
    const a = spots[i - 5], b = spots[i];
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      const r = Math.abs(b - a) / a * 1e4;
      if (r > max5sMoveBps) max5sMoveBps = r;
    }
  }

  // Strike crossings in the last 30s.
  let strikeCrossings = 0;
  const startX = Math.max(1, n - 30);
  for (let i = startX; i < n; i++) {
    const prev = spots[i - 1] - strike;
    const cur = spots[i] - strike;
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev * cur < 0) strikeCrossings += 1;
  }

  // Vol expansion: 1s stdev of last 15 vs prior 15.
  const sdOf = (from: number, to: number): number => {
    const arr: number[] = [];
    for (let i = Math.max(1, from); i < Math.min(n, to); i++) {
      const a = spots[i - 1], b = spots[i];
      if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) arr.push((b - a) / a);
    }
    if (arr.length < 2) return 0;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const varr = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(varr);
  };
  const sdRecent = sdOf(n - 15, n);
  const sdPrior = sdOf(n - 30, n - 15);
  const volExpanding = sdPrior > 0 ? sdRecent > sdPrior * 1.25 : sdRecent > 0;

  // Signed move toward the selected side. YES wins iff spot > strike.
  //   YES side + spot rising toward/above strike → positive
  //   NO  side + spot falling toward/below strike → positive
  let signedMoveTowardSide: number | null = null;
  if (ret30s != null) {
    signedMoveTowardSide = side === "YES" ? ret30s * 1e4 : -ret30s * 1e4;
  }

  return {
    n,
    ret5s, ret10s, ret15s, ret30s,
    move30sBps,
    expectedMove30sBps: expectedMove30sBpsCorrected,
    jumpRatio,
    velocityTowardStrikeBpsPerS,
    acceleration,
    max1sMoveBps, max5sMoveBps,
    strikeCrossings,
    volExpanding,
    signedMoveTowardSide,
  };
}

/** Convenience: bucket jumpRatio into the four-way scheme used by the plan. */
export function jumpRatioBucket(jr: number | null | undefined): "calm" | "1.0-1.5" | "1.5-2.0" | ">2.0" | "unknown" {
  if (jr == null || !Number.isFinite(jr)) return "unknown";
  if (jr < 1.0) return "calm";
  if (jr < 1.5) return "1.0-1.5";
  if (jr < 2.0) return "1.5-2.0";
  return ">2.0";
}
