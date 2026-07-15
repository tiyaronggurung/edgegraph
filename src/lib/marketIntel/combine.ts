// Rules-based combiner (shadow-only). Assembles the final MarketIntel object
// from structure + volatility + patterns + sequence + psychological levels.
// Priority: structure > sequence > vol-adjusted strike distance > patterns > psych.
// Named patterns can never outweigh structure+sequence.
// Psych levels NEVER create direction — they only modulate confidence within a cap.

import type {
  MarketIntel,
  MarketIntelInput,
  Direction,
  PatternDetection,
  StructureResult,
  VolatilityResult,
  SequenceAnalysis,
  PsychologicalLevelResult,
  MarketIntelStatus,
} from "./types";
import { MARKET_INTEL_VERSION } from "./types";
import { classifyStructure, classifyStructureSingle } from "./structure";
import { computeVolatility, atr } from "./volatility";
import { detectPatterns } from "./candlePatterns";
import { analyzeSequence } from "./sequence";
import { analyzePsychologicalLevels, PSYCH_ENGINE_VERSION } from "./psychologicalLevels";

const COMPONENT_VERSIONS = {
  structure: "v1",
  volatility: "v1",
  patterns: "v1",
  sequence: "v1",
  combiner: "v1",
  psychological_levels: PSYCH_ENGINE_VERSION,
} as const;

function dirScore(d: Direction) { return d === "UP" ? 1 : d === "DOWN" ? -1 : 0; }

function combinePatternScore(patterns: PatternDetection[]): { score: number; net: number } {
  if (patterns.length === 0) return { score: 0, net: 0 };
  let net = 0, absSum = 0;
  for (const p of patterns) {
    if (p.bias === "NEUTRAL") continue;
    const w = p.contextScore * (p.confirmed ? 1 : 0.7);
    net += dirScore(p.bias) * w;
    absSum += w;
  }
  const score = absSum > 0 ? Math.round(absSum / patterns.length) : 0;
  return { score, net: absSum > 0 ? net / absSum : 0 };
}

/** Cap for psychological modifier — never more than ±0.08 of raw vote. */
const PSYCH_CAP = 0.08;

function psychModifier(psych: PsychologicalLevelResult, rawBefore: number): { delta: number; reason: string | null } {
  if (psych.role === "none" || psych.strength < 40) return { delta: 0, reason: null };

  const towardsUp = rawBefore > 0;
  const towardsDown = rawBefore < 0;
  const s = psych.strength / 100; // 0..1

  // Strong resistance above → damp bullish continuation
  if (psych.role === "resistance" && (psych.state === "tested_held" || psych.state === "retest")) {
    if (towardsUp) return { delta: -PSYCH_CAP * s, reason: "resistance-held damps UP" };
  }
  // Strong support below → damp bearish continuation
  if (psych.role === "support" && (psych.state === "tested_held" || psych.state === "retest")) {
    if (towardsDown) return { delta: PSYCH_CAP * s, reason: "support-held damps DOWN" };
  }
  // Accepted breakout above resistance → boost UP
  if (psych.state === "accepted_breakout" && towardsUp) {
    return { delta: PSYCH_CAP * s, reason: "accepted breakout boosts UP" };
  }
  // Accepted breakdown below support → boost DOWN
  if (psych.state === "accepted_breakdown" && towardsDown) {
    return { delta: -PSYCH_CAP * s, reason: "accepted breakdown boosts DOWN" };
  }
  return { delta: 0, reason: null };
}

export function computeMarketIntel(input: MarketIntelInput): MarketIntel {
  const { spot, strike, candles1m, candles5m, candles15m } = input;

  const closed1 = candles1m.filter(c => c.closed);
  const closed5 = candles5m.filter(c => c.closed);
  const closed15 = candles15m.filter(c => c.closed);

  // Data-quality status
  let status: MarketIntelStatus = "computed";
  if (closed1.length < 5 || closed5.length < 3) status = "insufficient_data";
  else if (closed15.length < 3) status = "partial";

  // ---- Layers ----
  const structure: StructureResult = classifyStructure(candles1m, candles5m, candles15m);
  const vol: VolatilityResult = computeVolatility(spot, strike, candles1m, candles5m, candles15m);

  const struct5 = classifyStructureSingle(candles5m);
  const atr1m = atr(candles1m, 14);
  const atr5m = atr(candles5m, 14);
  const patterns1 = detectPatterns(candles1m, "1m", struct5, atr1m, structure.direction);
  const patterns5 = detectPatterns(candles5m, "5m", struct5, atr5m, structure.direction);
  const patterns: PatternDetection[] = [...patterns5, ...patterns1].slice(0, 8);

  const sequence: SequenceAnalysis = analyzeSequence(candles1m, candles5m, candles15m, structure);
  const { score: patternScore, net: patternNet } = combinePatternScore(patterns);

  const psych = analyzePsychologicalLevels(spot, candles1m, candles5m, atr5m);

  const reasons: string[] = [];
  const warnings: string[] = [];
  reasons.push(`structure=${structure.direction}(${structure.strength}) state=${structure.state}`);
  reasons.push(`sequence=${sequence.state} dir=${sequence.direction} conf=${sequence.confidence}`);
  reasons.push(`vol=${vol.regime} strikeΔ=${vol.strikeDistanceInExpectedMoves.toFixed(2)}σ`);
  if (psych.nearestLevel !== null) reasons.push(`psych=${psych.nearestLevel}/${psych.intervalUsd} ${psych.state} str=${psych.strength}`);

  if (status === "insufficient_data") {
    return buildNeutral(structure, vol, sequence, patterns, patternScore, psych, "insufficient_data", reasons, ["insufficient history"]);
  }

  // ---- Weighted vote ----
  const structVote = dirScore(structure.direction) * (structure.strength / 100);
  const seqVote = dirScore(sequence.direction) * (sequence.confidence / 100);
  const patVote = patternNet;
  let raw = 0.45 * structVote + 0.30 * seqVote + 0.15 * patVote;

  // ---- Conflict handling ----
  if (sequence.chopScore >= 55) {
    raw *= 0.3;
    warnings.push("chop dominant → confidence damped");
  }

  const bullExh = sequence.state === "bullish_exhaustion";
  const bearExh = sequence.state === "bearish_exhaustion";
  if ((bullExh || bearExh) && sequence.reversalScore < 60) {
    raw *= 0.55;
    warnings.push("exhaustion without reversal confirmation → damped");
  }

  if (
    structure.direction !== "NEUTRAL" &&
    sequence.direction !== "NEUTRAL" &&
    structure.direction !== sequence.direction &&
    !sequence.state.includes("pullback")
  ) {
    if (sequence.state.includes("reversal") && sequence.confidence >= 65) {
      reasons.push("strong reversal overrides structure");
    } else {
      raw *= 0.4;
      warnings.push("structure vs sequence conflict → neutral-leaning");
    }
  }

  if (
    (structure.direction === "UP" && sequence.state === "bullish_pullback") ||
    (structure.direction === "DOWN" && sequence.state === "bearish_pullback")
  ) {
    raw = dirScore(structure.direction) * Math.max(Math.abs(raw), 0.25);
    reasons.push("pullback within trend → weak with-trend bias");
  }

  if (vol.strikeDistanceInExpectedMoves > 2.0) {
    raw *= 0.55;
    warnings.push(`strike ${vol.strikeDistanceInExpectedMoves.toFixed(1)}σ away → hard to reach`);
  } else if (vol.strikeDistanceInExpectedMoves > 1.3) {
    raw *= 0.8;
  }

  if (vol.regime === "shock") {
    raw *= 0.6;
    warnings.push("vol shock → uncertain");
  } else if (vol.regime === "compressed") {
    raw *= 0.85;
  }

  // ---- Psychological modifier (capped, never creates direction) ----
  const psychMod = psychModifier(psych, raw);
  if (psychMod.delta !== 0 && psychMod.reason) {
    // Only apply if raw already has a direction. Never let psych flip sign.
    if (Math.sign(raw + psychMod.delta) === Math.sign(raw) || raw === 0) {
      raw += psychMod.delta;
      reasons.push(psychMod.reason);
    }
  }
  // Repeated crossings raise chop evidence
  if (psych.state === "chop_magnet") {
    raw *= 0.75;
    warnings.push("psych level chop-magnet → damped");
  }

  const absRaw = Math.abs(raw);
  let direction: Direction = "NEUTRAL";
  if (absRaw >= 0.18) direction = raw > 0 ? "UP" : "DOWN";
  const confidence = Math.max(0, Math.min(100, Math.round(absRaw * 100)));

  return {
    market_state: structure.state,
    structure_direction: structure.direction,
    structure_strength: structure.strength,

    detected_patterns: patterns,
    pattern_score: patternScore,

    sequence_state: sequence.state,
    continuation_score: sequence.continuationScore,
    reversal_score: sequence.reversalScore,
    exhaustion_score: sequence.exhaustionScore,
    chop_score: sequence.chopScore,
    compression_score: sequence.compressionScore,
    expansion_score: sequence.expansionScore,

    volatility_regime: vol.regime,
    expected_move_15m_usd: vol.expectedMove15mUsd,
    expected_move_15m_pct: vol.expectedMove15mPct,
    strike_distance_usd: vol.strikeDistanceUsd,
    strike_distance_in_expected_moves: vol.strikeDistanceInExpectedMoves,

    psych,

    direction,
    confidence,

    status,

    reasons: [...reasons, ...structure.reasons.map(r => `struct:${r}`), ...sequence.reasons.map(r => `seq:${r}`)],
    warnings: [...warnings, ...sequence.warnings],

    version: MARKET_INTEL_VERSION,
    component_versions: { ...COMPONENT_VERSIONS },
  };
}

function buildNeutral(
  structure: StructureResult,
  vol: VolatilityResult,
  sequence: SequenceAnalysis,
  patterns: PatternDetection[],
  patternScore: number,
  psych: PsychologicalLevelResult,
  status: MarketIntelStatus,
  reasons: string[],
  warnings: string[],
): MarketIntel {
  return {
    market_state: structure.state,
    structure_direction: structure.direction,
    structure_strength: structure.strength,
    detected_patterns: patterns,
    pattern_score: patternScore,
    sequence_state: sequence.state,
    continuation_score: sequence.continuationScore,
    reversal_score: sequence.reversalScore,
    exhaustion_score: sequence.exhaustionScore,
    chop_score: sequence.chopScore,
    compression_score: sequence.compressionScore,
    expansion_score: sequence.expansionScore,
    volatility_regime: vol.regime,
    expected_move_15m_usd: vol.expectedMove15mUsd,
    expected_move_15m_pct: vol.expectedMove15mPct,
    strike_distance_usd: vol.strikeDistanceUsd,
    strike_distance_in_expected_moves: vol.strikeDistanceInExpectedMoves,
    psych,
    direction: "NEUTRAL",
    confidence: 0,
    status,
    reasons,
    warnings,
    version: MARKET_INTEL_VERSION,
    component_versions: { ...COMPONENT_VERSIONS },
  };
}
