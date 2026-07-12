// Server-side jump-feature builder. Queries the btc_spot_ticks ring buffer for
// the last 120s of samples (strictly <= snapshotTs), applies data-quality
// gates, resamples to a 1s-per-slot spot buffer, and delegates to the pure
// computeJumpFeatures from cryptoJump.ts.
//
// Read-only Phase 1B collector. Never mutates gates or probability.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeJumpFeatures, type JumpFeatures } from "./cryptoJump";

export interface JumpQualityMeta {
  obs_count: number;
  latest_age_ms: number | null;
  max_gap_ms: number | null;
  coverage_ratio: number;
  source_mix: Record<string, number>;
  cutoff_ts: string;
}

export interface BuiltJumpFeatures {
  available: boolean;
  unavailable_reason?: string;
  source_quality: "primary" | "odds_tape_fallback" | "none";
  quality: JumpQualityMeta;
  features?: JumpFeatures;
  // Extended fields on top of pure computeJumpFeatures
  extra?: {
    ret1s: number | null;
    ret3s: number | null;
    absMove5sBps: number | null;
    absMove15sBps: number | null;
    absMove30sBps: number | null;
    expectedMove5sBps: number | null;
    expectedMove15sBps: number | null;
    expectedMove30sBps: number | null;
    jumpRatio5s: number | null;
    jumpRatio15s: number | null;
    jumpRatio30s: number | null;
    realizedVol5s: number | null;
    realizedVol15s: number | null;
    realizedVol30s: number | null;
    volExpansionRatio: number | null;
    strikeCrossings10s: number;
    strikeCrossings30s: number;
    strikeCrossings60s: number;
    secsSinceLastCrossing: number | null;
    pctTimeAboveStrike30s: number | null;
    contested: boolean;
    sideMovementBps: number | null;
  };
}

export interface BuildJumpInput {
  snapshotTs: Date;
  strike: number;
  side: "YES" | "NO";
  sigmaMinPct: number; // per-minute realized σ used by diffusion (percent)
}

interface TickRow {
  observed_at: string;
  spot: number;
  source: string;
}

const MIN_OBS_30S = 20;
const MAX_LATEST_AGE_MS = 3000;
const MAX_GAP_MS = 5000;
const MIN_COVERAGE = 0.8;

export async function buildJumpFeatures(input: BuildJumpInput): Promise<BuiltJumpFeatures> {
  const cutoffMs = input.snapshotTs.getTime();
  const startMs = cutoffMs - 120_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const startIso = new Date(startMs).toISOString();

  let ticks: TickRow[] = [];
  let sourceQuality: BuiltJumpFeatures["source_quality"] = "primary";
  try {
    const { data } = await supabaseAdmin
      .from("btc_spot_ticks")
      .select("observed_at, spot, source")
      .lte("observed_at", cutoffIso)
      .gt("observed_at", startIso)
      .order("observed_at", { ascending: true })
      .limit(500);
    ticks = (data ?? []) as TickRow[];
  } catch (e) {
    // Continue to fallback path.
  }

  // Fallback to btc_odds_tape spot column when primary is insufficient.
  if (ticks.length < MIN_OBS_30S) {
    try {
      const { data } = await supabaseAdmin
        .from("btc_odds_tape")
        .select("recorded_at, spot")
        .lte("recorded_at", cutoffIso)
        .gt("recorded_at", startIso)
        .order("recorded_at", { ascending: true })
        .limit(500);
      const fallback: TickRow[] = (data ?? [])
        .filter((r: any) => Number(r.spot) > 0)
        .map((r: any) => ({
          observed_at: r.recorded_at as string,
          spot: Number(r.spot),
          source: "odds_tape",
        }));
      if (fallback.length > ticks.length) {
        ticks = fallback;
        sourceQuality = "odds_tape_fallback";
      }
    } catch {
      // ignore
    }
  }

  const quality = buildQuality(ticks, cutoffIso);

  if (!ticks.length) {
    return {
      available: false,
      unavailable_reason: "no ticks",
      source_quality: "none",
      quality,
    };
  }

  // Data-quality gates
  const last30sTicks = ticks.filter(t => new Date(t.observed_at).getTime() >= cutoffMs - 30_000);
  if (last30sTicks.length < MIN_OBS_30S) {
    return { available: false, unavailable_reason: `obs<${MIN_OBS_30S} in 30s`, source_quality: sourceQuality, quality };
  }
  if (quality.latest_age_ms != null && quality.latest_age_ms > MAX_LATEST_AGE_MS) {
    return { available: false, unavailable_reason: `latest tick age ${quality.latest_age_ms}ms`, source_quality: sourceQuality, quality };
  }
  if (quality.max_gap_ms != null && quality.max_gap_ms > MAX_GAP_MS) {
    return { available: false, unavailable_reason: `gap ${quality.max_gap_ms}ms`, source_quality: sourceQuality, quality };
  }
  if (quality.coverage_ratio < MIN_COVERAGE) {
    return { available: false, unavailable_reason: `coverage ${quality.coverage_ratio.toFixed(2)}`, source_quality: sourceQuality, quality };
  }

  // Resample to 1s-per-slot spot array covering [cutoff - 30s, cutoff].
  const spots = resampleTo1sBuffer(ticks, cutoffMs, 30);
  const features = computeJumpFeatures({
    spots,
    strike: input.strike,
    side: input.side,
    sigmaMinPct: input.sigmaMinPct,
  });

  const extra = computeExtra(ticks, cutoffMs, input.strike, input.side, input.sigmaMinPct);

  return {
    available: true,
    source_quality: sourceQuality,
    quality,
    features,
    extra,
  };
}

function buildQuality(ticks: TickRow[], cutoffIso: string): JumpQualityMeta {
  if (!ticks.length) {
    return {
      obs_count: 0,
      latest_age_ms: null,
      max_gap_ms: null,
      coverage_ratio: 0,
      source_mix: {},
      cutoff_ts: cutoffIso,
    };
  }
  const cutoffMs = new Date(cutoffIso).getTime();
  const timestamps = ticks.map(t => new Date(t.observed_at).getTime()).sort((a, b) => a - b);
  const latestAgeMs = cutoffMs - timestamps[timestamps.length - 1];
  let maxGap = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > maxGap) maxGap = gap;
  }
  const windowStart = cutoffMs - 30_000;
  const inWindow = timestamps.filter(t => t >= windowStart);
  const coverage = Math.min(1, inWindow.length / 30);
  const mix: Record<string, number> = {};
  for (const t of ticks) mix[t.source] = (mix[t.source] ?? 0) + 1;
  return {
    obs_count: ticks.length,
    latest_age_ms: latestAgeMs,
    max_gap_ms: maxGap,
    coverage_ratio: coverage,
    source_mix: mix,
    cutoff_ts: cutoffIso,
  };
}

function resampleTo1sBuffer(ticks: TickRow[], cutoffMs: number, seconds: number): number[] {
  const buf: number[] = new Array(seconds).fill(0);
  const byBucket = new Map<number, number[]>();
  for (const t of ticks) {
    const ts = new Date(t.observed_at).getTime();
    if (ts > cutoffMs) continue;
    const secAgo = Math.floor((cutoffMs - ts) / 1000);
    if (secAgo >= seconds || secAgo < 0) continue;
    const slot = seconds - 1 - secAgo;
    if (!byBucket.has(slot)) byBucket.set(slot, []);
    byBucket.get(slot)!.push(t.spot);
  }
  let lastKnown = 0;
  for (let i = 0; i < seconds; i++) {
    const arr = byBucket.get(i);
    if (arr && arr.length) {
      lastKnown = arr.reduce((s, v) => s + v, 0) / arr.length;
    }
    buf[i] = lastKnown;
  }
  // Forward-fill trailing zeros with the first known value walking back
  if (buf[0] === 0) {
    const firstNon = buf.find(v => v > 0) ?? 0;
    for (let i = 0; i < buf.length && buf[i] === 0; i++) buf[i] = firstNon;
  }
  return buf;
}

function computeExtra(
  ticks: TickRow[],
  cutoffMs: number,
  strike: number,
  side: "YES" | "NO",
  sigmaMinPct: number,
): BuiltJumpFeatures["extra"] {
  const timed = ticks
    .map(t => ({ ts: new Date(t.observed_at).getTime(), spot: t.spot }))
    .filter(t => t.ts <= cutoffMs && Number.isFinite(t.spot) && t.spot > 0)
    .sort((a, b) => a.ts - b.ts);
  if (timed.length < 2) return undefined;
  const last = timed[timed.length - 1];

  const priceAtSecondsAgo = (secs: number): number | null => {
    const target = cutoffMs - secs * 1000;
    let best: typeof timed[0] | null = null;
    for (const t of timed) {
      if (t.ts <= target) best = t;
      else break;
    }
    return best?.spot ?? null;
  };

  const retAt = (secs: number): number | null => {
    const p = priceAtSecondsAgo(secs);
    if (p == null || p <= 0) return null;
    return (last.spot - p) / p;
  };

  const ret1s = retAt(1);
  const ret3s = retAt(3);
  const ret5s = retAt(5);
  const ret15s = retAt(15);
  const ret30s = retAt(30);

  const abs = (r: number | null): number | null => r == null ? null : Math.abs(r) * 1e4;
  const expectedMove = (secs: number): number | null => {
    if (!(sigmaMinPct > 0)) return null;
    return sigmaMinPct * Math.sqrt(secs / 60) * 100; // bps
  };
  const absMove5 = abs(ret5s);
  const absMove15 = abs(ret15s);
  const absMove30 = abs(ret30s);
  const exp5 = expectedMove(5);
  const exp15 = expectedMove(15);
  const exp30 = expectedMove(30);

  const ratio = (a: number | null, b: number | null): number | null =>
    a != null && b != null && b > 0 ? a / b : null;

  // Realized vol over N seconds: stddev of 1s log-returns.
  const rvOver = (secs: number): number | null => {
    const startTs = cutoffMs - secs * 1000;
    const seg = timed.filter(t => t.ts >= startTs);
    if (seg.length < 2) return null;
    const rets: number[] = [];
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1].spot, b = seg[i].spot;
      if (a > 0) rets.push(Math.log(b / a));
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const varr = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
    return Math.sqrt(varr);
  };
  const rv5 = rvOver(5);
  const rv15 = rvOver(15);
  const rv30 = rvOver(30);

  // Previous 30s vol for expansion ratio
  const prevSeg = timed.filter(t => t.ts >= cutoffMs - 60_000 && t.ts < cutoffMs - 30_000);
  let prevRv: number | null = null;
  if (prevSeg.length >= 2) {
    const rets: number[] = [];
    for (let i = 1; i < prevSeg.length; i++) {
      const a = prevSeg[i - 1].spot, b = prevSeg[i].spot;
      if (a > 0) rets.push(Math.log(b / a));
    }
    if (rets.length >= 2) {
      const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
      const varr = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
      prevRv = Math.sqrt(varr);
    }
  }
  const volExpansionRatio = rv30 != null && prevRv != null && prevRv > 0 ? rv30 / prevRv : null;

  // Strike crossings within N seconds ending at cutoff.
  const countCrossings = (secs: number): number => {
    const startTs = cutoffMs - secs * 1000;
    const seg = timed.filter(t => t.ts >= startTs);
    let cnt = 0;
    for (let i = 1; i < seg.length; i++) {
      const p = seg[i - 1].spot - strike;
      const c = seg[i].spot - strike;
      if (p * c < 0) cnt++;
    }
    return cnt;
  };
  const cross10 = countCrossings(10);
  const cross30 = countCrossings(30);
  const cross60 = countCrossings(60);

  // Seconds since last crossing (any horizon).
  let secsSinceLastCrossing: number | null = null;
  for (let i = timed.length - 1; i >= 1; i--) {
    const p = timed[i - 1].spot - strike;
    const c = timed[i].spot - strike;
    if (p * c < 0) {
      secsSinceLastCrossing = (cutoffMs - timed[i].ts) / 1000;
      break;
    }
  }

  // Time-weighted % above strike over last 30s
  const startTs = cutoffMs - 30_000;
  const seg30 = timed.filter(t => t.ts >= startTs);
  let timeAbove = 0, timeTotal = 0;
  for (let i = 1; i < seg30.length; i++) {
    const dt = seg30[i].ts - seg30[i - 1].ts;
    timeTotal += dt;
    if (seg30[i - 1].spot > strike) timeAbove += dt;
  }
  const pctAbove = timeTotal > 0 ? timeAbove / timeTotal : null;
  const contested = cross30 >= 2;

  // Side-signed movement (positive = favorable to selected side).
  let sideMovementBps: number | null = null;
  if (ret30s != null) {
    sideMovementBps = side === "YES" ? ret30s * 1e4 : -ret30s * 1e4;
  }

  return {
    ret1s, ret3s,
    absMove5sBps: absMove5,
    absMove15sBps: absMove15,
    absMove30sBps: absMove30,
    expectedMove5sBps: exp5,
    expectedMove15sBps: exp15,
    expectedMove30sBps: exp30,
    jumpRatio5s: ratio(absMove5, exp5),
    jumpRatio15s: ratio(absMove15, exp15),
    jumpRatio30s: ratio(absMove30, exp30),
    realizedVol5s: rv5,
    realizedVol15s: rv15,
    realizedVol30s: rv30,
    volExpansionRatio,
    strikeCrossings10s: cross10,
    strikeCrossings30s: cross30,
    strikeCrossings60s: cross60,
    secsSinceLastCrossing,
    pctTimeAboveStrike30s: pctAbove,
    contested,
    sideMovementBps,
  };
}
