// Shadow-only Market Intelligence types. Phase 1.
// No I/O in this file. See marketIntel.functions.ts for persistence.

export const MARKET_INTEL_VERSION = "phase1.v1" as const;

export type MarketState = "bull_trend" | "bear_trend" | "range" | "transition";
export type Direction = "UP" | "DOWN" | "NEUTRAL";
export type VolatilityRegime = "compressed" | "normal" | "expanding" | "shock";
export type Timeframe = "1m" | "5m" | "15m";

export type SequenceState =
  | "bullish_continuation"
  | "bearish_continuation"
  | "bullish_pullback"
  | "bearish_pullback"
  | "bullish_reversal"
  | "bearish_reversal"
  | "bullish_exhaustion"
  | "bearish_exhaustion"
  | "compression"
  | "expansion"
  | "chop"
  | "transition"
  | "neutral";

/** OHLC candle. `closed=true` means the bar is finalized. */
export interface Candle {
  t: number;      // open time ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  closed: boolean;
}

export interface StructurePoint {
  t: number;
  price: number;
  kind: "SH" | "SL";
}

export interface StructureResult {
  state: MarketState;
  direction: Direction;
  strength: number;
  swings: StructurePoint[];
  hh: boolean;
  hl: boolean;
  lh: boolean;
  ll: boolean;
  reasons: string[];
}

export interface VolatilityResult {
  atr1m: number | null;
  atr5m: number | null;
  atr15m: number | null;
  realizedVolPct: number | null;
  regime: VolatilityRegime;
  expectedMove15mUsd: number;
  expectedMove15mPct: number;
  strikeDistanceUsd: number;
  strikeDistanceInExpectedMoves: number;
  reasons: string[];
}

/** Rich pattern detection (Turn 2). */
export interface PatternDetection {
  name: string;
  timeframe: Timeframe;
  bias: Direction;
  strength: number;       // 0..100 raw geometry
  confirmed: boolean;     // next completed candle confirms bias
  contextScore: number;   // 0..100 final context-adjusted score
  reasons: string[];
  warnings: string[];
}

export interface SequenceAnalysis {
  state: SequenceState;
  direction: Direction;
  confidence: number;         // 0..100
  continuationScore: number;
  reversalScore: number;
  exhaustionScore: number;
  chopScore: number;
  compressionScore: number;
  expansionScore: number;
  reasons: string[];
  warnings: string[];
}

/** Legacy compact pattern (kept for backward compat). */
export interface CandlePatternHit {
  name: string;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  bodyPct: number;
  wickTopPct: number;
  wickBottomPct: number;
  candleIndex: number;
}

export interface MarketIntel {
  market_state: MarketState;
  structure_direction: Direction;
  structure_strength: number;

  detected_patterns: PatternDetection[];
  pattern_score: number;

  sequence_state: SequenceState;
  continuation_score: number;
  reversal_score: number;
  exhaustion_score: number;
  chop_score: number;
  compression_score: number;
  expansion_score: number;

  volatility_regime: VolatilityRegime;
  expected_move_15m_usd: number;
  expected_move_15m_pct: number;
  strike_distance_usd: number;
  strike_distance_in_expected_moves: number;

  direction: Direction;
  confidence: number;

  reasons: string[];
  warnings: string[];

  version: typeof MARKET_INTEL_VERSION;
}

export interface MarketIntelInput {
  spot: number;
  strike: number;
  candles1m: Candle[];
  candles5m: Candle[];
  candles15m: Candle[];
  nowMs?: number;
}
