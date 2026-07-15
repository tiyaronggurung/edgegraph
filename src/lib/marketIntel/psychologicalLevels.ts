// Psychological / round-number level engine.
// Volatility-adjusted zones around $50/$100/$250/$500/$1000 multiples.
// Scores strength using touches, rejections, crossings, acceptance, retests,
// polarity flips, and staleness. Deterministic. Closed candles only.
// A level NEVER creates UP/DOWN direction — it only modulates confidence.

import type { Candle, PsychologicalLevelResult, PsychLevelState, PsychLevelRole } from "./types";

export const PSYCH_ENGINE_VERSION = "v1" as const;

const INTERVALS = [50, 100, 250, 500, 1000] as const;

function nearestMultiple(price: number, interval: number): number {
  return Math.round(price / interval) * interval;
}

/**
 * Zone half-width in USD around a level. Scales with ATR so a $50 level in
 * calm markets is narrow and the same level in a shock regime is wider.
 */
function zoneHalfWidth(interval: number, atr: number): number {
  // Baseline: 8% of the interval; expand with ATR up to 40% of interval.
  const base = interval * 0.08;
  const atrBoost = Math.min(interval * 0.32, (atr ?? 0) * 0.6);
  return base + atrBoost;
}

interface Interaction {
  kind: "touch" | "rejection_up" | "rejection_down" | "close_above" | "close_below" | "wick_through";
  candleIdx: number;
}

/**
 * Walk closed candles and record every meaningful interaction with a level.
 * "touch" = candle range intersects the zone.
 * "rejection_up" = touched from below, closed at least half-zone back below.
 * "rejection_down" = touched from above, closed at least half-zone back above.
 * "close_above" / "close_below" = clean close outside the zone.
 * "wick_through" = wick pierced but close remained inside zone.
 */
function walkInteractions(candles: Candle[], level: number, halfWidth: number, atr: number): Interaction[] {
  const zoneLo = level - halfWidth;
  const zoneHi = level + halfWidth;
  // Proximity: candle must get near the actual level line, not just inside the wide zone.
  // "Near" = the candle's closest edge is within max(halfWidth, 0.75*ATR) of the line,
  // or the candle straddles the line outright.
  const proximity = Math.max(halfWidth, atr * 0.75);
  const out: Interaction[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const straddles = c.l <= level && c.h >= level;
    const nearHigh = Math.abs(c.h - level) <= proximity;
    const nearLow = Math.abs(c.l - level) <= proximity;
    if (!straddles && !nearHigh && !nearLow) continue;

    const closedAbove = c.c > zoneHi;
    const closedBelow = c.c < zoneLo;
    const wickedAbove = c.h > zoneHi;
    const wickedBelow = c.l < zoneLo;

    if (closedAbove && wickedBelow) out.push({ kind: "close_above", candleIdx: i });
    else if (closedBelow && wickedAbove) out.push({ kind: "close_below", candleIdx: i });
    else if (closedAbove) out.push({ kind: "close_above", candleIdx: i });
    else if (closedBelow) out.push({ kind: "close_below", candleIdx: i });
    else {
      if (wickedAbove && c.c < level) out.push({ kind: "rejection_down", candleIdx: i });
      else if (wickedBelow && c.c > level) out.push({ kind: "rejection_up", candleIdx: i });
      else if (wickedAbove || wickedBelow) out.push({ kind: "wick_through", candleIdx: i });
      else out.push({ kind: "touch", candleIdx: i });
    }
  }
  return out;
}

/** Count level crossings (sign changes of close vs level). */
function countCrossings(candles: Candle[], level: number): number {
  let x = 0;
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1].c - level;
    const b = candles[i].c - level;
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) x++;
  }
  return x;
}

interface LevelScore {
  level: number;
  interval: number;
  role: PsychLevelRole;
  strength: number;
  state: PsychLevelState;
  crossings: number;
  touches: number;
  reasons: string[];
}

/** Score one interval-family's nearest level relative to current spot. */
function scoreLevel(spot: number, interval: number, candles: Candle[], atr: number): LevelScore {
  const level = nearestMultiple(spot, interval);
  const halfWidth = zoneHalfWidth(interval, atr);
  const inters = walkInteractions(candles, level, halfWidth, atr);
  const crossings = countCrossings(candles, level);

  const reasons: string[] = [];
  const touches = inters.length;

  // Recency weighting: more recent interactions weigh more.
  const N = candles.length;
  let rejectionScore = 0;
  let acceptanceUp = 0;
  let acceptanceDown = 0;
  let wickOnly = 0;
  let lastInteractionAge = N;

  for (const it of inters) {
    const age = N - it.candleIdx;
    const w = Math.max(0.2, 1 - age / Math.max(N, 20));
    if (it.kind === "rejection_up") rejectionScore += 20 * w;
    else if (it.kind === "rejection_down") rejectionScore += 20 * w;
    else if (it.kind === "close_above") acceptanceUp += 15 * w;
    else if (it.kind === "close_below") acceptanceDown += 15 * w;
    else if (it.kind === "wick_through") wickOnly += 5 * w;
    else rejectionScore += 4 * w; // plain touch
    if (age < lastInteractionAge) lastInteractionAge = age;
  }

  // Role: which side of the level is spot?
  const above = spot > level;
  const role: PsychLevelRole = above ? "support" : (spot < level ? "resistance" : "none");

  // Determine state
  let state: PsychLevelState = "untested";
  if (touches === 0) state = "untested";
  else if (crossings >= 4) state = "chop_magnet";
  else if (above && acceptanceUp > 20 && acceptanceUp > acceptanceDown) {
    // Spot is above, and we've cleanly accepted breakouts up.
    state = acceptanceDown > 10 ? "polarity_flip" : "accepted_breakout";
  } else if (!above && acceptanceDown > 20 && acceptanceDown > acceptanceUp) {
    state = acceptanceUp > 10 ? "polarity_flip" : "accepted_breakdown";
  } else if (rejectionScore > 25 && crossings === 0) state = "tested_held";
  else if (crossings >= 1) state = "tested_broken";
  else if (lastInteractionAge > N * 0.7) state = "stale";
  else state = "tested_held";

  // Confirm retest — accepted breakout followed by a return to the level.
  if ((state === "accepted_breakout" || state === "accepted_breakdown") && lastInteractionAge < N * 0.15) {
    state = "retest";
  }

  // Strength: weighted evidence, capped.
  let strength = 0;
  if (state === "untested") strength = Math.max(10, Math.min(30, 30 - (interval / 100) * 2));
  else if (state === "stale") strength = 20;
  else if (state === "chop_magnet") strength = 40;
  else if (state === "accepted_breakout" || state === "accepted_breakdown") strength = Math.min(85, 45 + Math.max(acceptanceUp, acceptanceDown));
  else if (state === "polarity_flip") strength = 70;
  else if (state === "retest") strength = 75;
  else if (state === "tested_held") strength = Math.min(90, 45 + rejectionScore * 0.8);
  else strength = 30;

  // Bigger round numbers matter more.
  const intervalBoost = interval >= 1000 ? 1.15 : interval >= 500 ? 1.08 : interval >= 250 ? 1.03 : 1.0;
  strength = Math.max(0, Math.min(100, Math.round(strength * intervalBoost)));

  reasons.push(`level=${level} interval=${interval} state=${state}`);
  reasons.push(`touches=${touches} crossings=${crossings} rej=${Math.round(rejectionScore)}`);
  if (wickOnly > 0) reasons.push(`wick_only=${Math.round(wickOnly)}`);

  return { level, interval, role, strength, state, crossings, touches, reasons };
}

export function analyzePsychologicalLevels(
  spot: number,
  candles1m: Candle[],
  candles5m: Candle[],
  atr5m: number | null,
): PsychologicalLevelResult {
  if (!Number.isFinite(spot) || spot <= 0) {
    return emptyResult(spot);
  }
  const closed1 = candles1m.filter(c => c.closed);
  const closed5 = candles5m.filter(c => c.closed);
  const history = closed5.length >= 8 ? closed5 : closed1;
  if (history.length < 4) return emptyResult(spot);

  const atr = atr5m && atr5m > 0 ? atr5m : Math.max(...history.slice(-10).map(c => c.h - c.l)) * 0.6;

  const scored = INTERVALS.map(iv => scoreLevel(spot, iv, history, atr));

  // Pick the "nearest" level as the highest-strength one whose zone is within
  // ~1.2 ATR of spot; if none, fall back to the physically closest by distance.
  const inReach = scored.filter(s => Math.abs(spot - s.level) <= atr * 1.5 || Math.abs(spot - s.level) <= s.interval * 0.15);
  const primary = (inReach.length > 0
    ? [...inReach].sort((a, b) => b.strength - a.strength)[0]
    : [...scored].sort((a, b) => Math.abs(spot - a.level) - Math.abs(spot - b.level))[0]);

  // Confluence: how many other interval families have an in-reach level with strength≥40?
  const confluent = scored.filter(s => s !== primary && (Math.abs(spot - s.level) <= atr * 1.5) && s.strength >= 40).length;
  const confluenceScore = Math.min(100, confluent * 25);

  return {
    nearestLevel: primary.level,
    intervalUsd: primary.interval,
    role: primary.role,
    strength: primary.strength,
    distanceUsd: Math.abs(spot - primary.level),
    distanceAtr: atr > 0 ? Math.abs(spot - primary.level) / atr : 0,
    state: primary.state,
    confluenceScore,
    crossings: primary.crossings,
    touches: primary.touches,
    reasons: [...primary.reasons, confluent > 0 ? `confluence=${confluent}` : "no confluence"],
  };
}

function emptyResult(_spot: number): PsychologicalLevelResult {
  return {
    nearestLevel: null,
    intervalUsd: 0,
    role: "none",
    strength: 0,
    distanceUsd: 0,
    distanceAtr: 0,
    state: "none",
    confluenceScore: 0,
    crossings: 0,
    touches: 0,
    reasons: ["insufficient history for psych levels"],
  };
}
