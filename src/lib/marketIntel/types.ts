// Shadow-only Market Intelligence types. Phase 1.
// No I/O in this file. See marketIntel.functions.ts for persistence.

export const MARKET_INTEL_VERSION = "phase1.v1" as const;

export type MarketState = "bull_trend" | "bear_trend" | "range" | "transition";
export type Direction = "UP" | "DOWN" | "NEUTRAL";
export type VolatilityRegime = "compressed" | "normal" | "expanding" | "shock";

/** OHLC candle. `closed=true` means the bar is finalized. */
export interface Candle {
  t: number;      // open time ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;      // volume (base asset, e.g. BTC)
  closed: boolean;
}

export interface StructurePoint {
  t: number;
  price: number;
  kind: "SH" | "SL"; // swing high / swing low
}

export interface StructureResult {
  state: MarketState;
  direction: Direction;
  strength: number;              // 0..100
  swings: StructurePoint[];       // most recent 6-10
  hh: boolean;                    // last two SH: higher high
  hl: boolean;                    // last two SL: higher low
  lh: boolean;
  ll: boolean;
  reasons: string[];
}

export interface VolatilityResult {
  atr1m: number | null;
  atr5m: number | null;
  atr15m: number | null;
  realizedVolPct: number | null;      // stddev of 1m returns (%)
  regime: VolatilityRegime;
  expectedMove15mUsd: number;         // best-effort $ expected 1σ move over 15m
  expectedMove15mPct: number;         // same in %
  strikeDistanceUsd: number;
  strikeDistanceInExpectedMoves: number;
  reasons: string[];
}

export interface CandlePatternHit {
  name: string;
  direction: "bullish" | "bearish" | "neutral"; // raw shape only — context resolves final
  strength: number;                              // 0..100 (body/range/wick geometry)
  bodyPct: number;                               // |c-o| / (h-l)
  wickTopPct: number;
  wickBottomPct: number;
  candleIndex: number;                           // -1 = latest closed, -2 = prior, ...
}

export interface SequenceScores {
  continuation: number;   // 0..100
  pullback: number;
  reversal: number;
  exhaustion: number;
  chop: number;
  compression: number;
  expansion: number;
  reasons: string[];
}

export interface MarketIntel {
  market_state: MarketState;
  structure_direction: Direction;
  structure_strength: number;

  candle_pattern: CandlePatternHit[];
  pattern_score: number;

  continuation_score: number;
  reversal_score: number;
  exhaustion_score: number;
  chop_score: number;
  compression_score: number;

  volatility_regime: VolatilityRegime;
  expected_move_15m_usd: number;
  expected_move_15m_pct: number;
  strike_distance_usd: number;
  strike_distance_in_expected_moves: number;

  direction: Direction;
  confidence: number; // 0..100

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
  /** Timestamp treated as "now" for tests. Defaults to Date.now(). */
  nowMs?: number;
}
