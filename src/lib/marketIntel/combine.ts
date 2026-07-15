// Rules-based combiner (shadow-only). Assembles the final MarketIntel object
// from structure + volatility + patterns + sequence.
// Priority: structure > sequence > vol-adjusted strike distance > patterns.
// Named patterns can never outweigh structure+sequence.

import type {
  MarketIntel,
  MarketIntelInput,
  Direction,
  PatternDetection,
  StructureResult,
  VolatilityResult,
  SequenceAnalysis,
} from "./types";
import { MARKET_INTEL_VERSION } from "./types";
import { classifyStructure, classifyStructureSingle } from "./structure";
import { computeVolatility, atr } from "./volatility";
import { detectPatterns } from "./candlePatterns";
import { analyzeSequence } from "./sequence";

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
  return { score, net: absSum > 0 ? net / absSum : 0 }; // net ∈ [-1,1]
}

export function computeMarketIntel(input: MarketIntelInput): MarketIntel {
  const { spot, strike, candles1m, candles5m, candles15m } = input;

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

  const reasons: string[] = [];
  const warnings: string[] = [];
  reasons.push(`structure=${structure.direction}(${structure.strength}) state=${structure.state}`);
  reasons.push(`sequence=${sequence.state} dir=${sequence.direction} conf=${sequence.confidence}`);
  reasons.push(`vol=${vol.regime} strikeΔ=${vol.strikeDistanceInExpectedMoves.toFixed(2)}σ`);

  // ---- Weighted vote ----
  // structure 0.45, sequence 0.30, patterns 0.15, vol distance modifier 0.10
  const structVote = dirScore(structure.direction) * (structure.strength / 100);
  const seqVote = dirScore(sequence.direction) * (sequence.confidence / 100);
  const patVote = patternNet; // already -1..1
  let raw = 0.45 * structVote + 0.30 * seqVote + 0.15 * patVote;

  // ---- Conflict handling ----

  // Chop dominant → force neutral
  if (sequence.chopScore >= 55) {
    raw *= 0.3;
    warnings.push("chop dominant → confidence damped");
  }

  // Exhaustion without confirmed reversal → damp continuation, don't flip
  const bullExh = sequence.state === "bullish_exhaustion";
  const bearExh = sequence.state === "bearish_exhaustion";
  if ((bullExh || bearExh) && sequence.reversalScore < 60) {
    raw *= 0.55;
    warnings.push("exhaustion without reversal confirmation → damped");
  }

  // Structure vs sequence direct conflict
  if (
    structure.direction !== "NEUTRAL" &&
    sequence.direction !== "NEUTRAL" &&
    structure.direction !== sequence.direction &&
    !sequence.state.includes("pullback")
  ) {
    // Only strong reversal evidence should flip us
    if (sequence.state.includes("reversal") && sequence.confidence >= 65) {
      // let sequence win — no extra damping
      reasons.push("strong reversal overrides structure");
    } else {
      raw *= 0.4;
      warnings.push("structure vs sequence conflict → neutral-leaning");
    }
  }

  // Structure bullish + bearish pullback → weak UP (structure wins, keep small size)
  if (
    (structure.direction === "UP" && sequence.state === "bullish_pullback") ||
    (structure.direction === "DOWN" && sequence.state === "bearish_pullback")
  ) {
    raw = dirScore(structure.direction) * Math.max(Math.abs(raw), 0.25);
    reasons.push("pullback within trend → weak with-trend bias");
  }

  // Strike far outside expected 15m move → reduce confidence in crossings/settlement
  if (vol.strikeDistanceInExpectedMoves > 2.0) {
    raw *= 0.55;
    warnings.push(`strike ${vol.strikeDistanceInExpectedMoves.toFixed(1)}σ away → hard to reach`);
  } else if (vol.strikeDistanceInExpectedMoves > 1.3) {
    raw *= 0.8;
  }

  // Volatility regime nudges
  if (vol.regime === "shock") {
    raw *= 0.6;
    warnings.push("vol shock → uncertain");
  } else if (vol.regime === "compressed") {
    raw *= 0.85;
  }

  // ---- Final direction/confidence ----
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

    direction,
    confidence,

    reasons: [...reasons, ...structure.reasons.map(r => `struct:${r}`), ...sequence.reasons.map(r => `seq:${r}`)],
    warnings: [...warnings, ...sequence.warnings],

    version: MARKET_INTEL_VERSION,
  };
}
