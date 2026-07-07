// Combines the four TA signals into a single directional verdict.
// SHADOW-ONLY — output is logged for study, never used for live gating.
import {
  type Candle,
  type TrendDir,
  emaTrend,
  findSwingLevels,
  findRoundLevels,
  rejectionWick,
} from "./chartSignals";

export type TaDir = "YES" | "NO" | "neutral";

export interface TaTimeframeVerdict {
  direction: TaDir;
  confidence: number; // 0..1 (fraction of active signals agreeing)
  trend: TrendDir;
  support: number | null;
  resistance: number | null;
  rejectionFlag: boolean;
  reasons: string[];
}

export interface TaVerdict {
  price: number | null;
  tf1m: TaTimeframeVerdict;
  tf5m: TaTimeframeVerdict;
  combined: {
    direction: TaDir;
    confidence: number;
    reasons: string[];
  };
  roundLevel: number | null;
}

function trendToDir(t: TrendDir): TaDir {
  return t === "up" ? "YES" : t === "down" ? "NO" : "neutral";
}

function verdictFor(candles: Candle[], label: string): TaTimeframeVerdict {
  const empty: TaTimeframeVerdict = {
    direction: "neutral",
    confidence: 0,
    trend: "flat",
    support: null,
    resistance: null,
    rejectionFlag: false,
    reasons: [],
  };
  if (!candles.length) return empty;
  const price = candles[candles.length - 1].c;
  const trend = emaTrend(candles);
  const { support, resistance } = findSwingLevels(candles, 2);
  const round = findRoundLevels(price);
  const nearestLevel =
    support != null && resistance != null
      ? Math.abs(price - support) < Math.abs(price - resistance)
        ? support
        : resistance
      : (support ?? resistance ?? round.nearest);
  const wick = rejectionWick(candles, nearestLevel);

  // Vote: each signal contributes YES/NO/neutral.
  const votes: TaDir[] = [];
  const reasons: string[] = [];

  const trendVote = trendToDir(trend);
  votes.push(trendVote);
  reasons.push(`${label}:trend=${trend}`);

  // S/R proximity: near support with room upward → bullish; near resistance → bearish.
  if (support && resistance) {
    const spanFromSupport = (price - support) / (resistance - support);
    if (spanFromSupport < 0.25) {
      votes.push("YES");
      reasons.push(`${label}:near-support`);
    } else if (spanFromSupport > 0.75) {
      votes.push("NO");
      reasons.push(`${label}:near-resistance`);
    } else {
      votes.push("neutral");
    }
  } else {
    votes.push("neutral");
  }

  // Round level proximity (within 0.15% acts as magnet — direction is neutral until wick fires).
  if (round.distancePct < 0.0015) {
    reasons.push(`${label}:round=${round.nearest}`);
  }

  // Rejection wick.
  if (wick.present) {
    const vote: TaDir = wick.direction === "bullish" ? "YES" : "NO";
    votes.push(vote);
    reasons.push(`${label}:wick-${wick.direction}`);
  } else {
    votes.push("neutral");
  }

  // Tally.
  const yesN = votes.filter((v) => v === "YES").length;
  const noN = votes.filter((v) => v === "NO").length;
  const active = yesN + noN;
  let direction: TaDir = "neutral";
  let confidence = 0;
  if (active > 0) {
    if (yesN > noN) {
      direction = "YES";
      confidence = yesN / votes.length;
    } else if (noN > yesN) {
      direction = "NO";
      confidence = noN / votes.length;
    }
  }

  return {
    direction,
    confidence,
    trend,
    support,
    resistance,
    rejectionFlag: wick.present,
    reasons,
  };
}

export function getChartVerdict(candles1m: Candle[], candles5m: Candle[]): TaVerdict {
  const tf1m = verdictFor(candles1m, "1m");
  const tf5m = verdictFor(candles5m, "5m");
  const price = candles1m.length ? candles1m[candles1m.length - 1].c : null;
  const round = price != null ? findRoundLevels(price) : null;

  // Combined: 5m wins unless neutral; then fall back to 1m.
  let direction: TaDir = tf5m.direction;
  let confidence = tf5m.confidence;
  if (direction === "neutral") {
    direction = tf1m.direction;
    confidence = tf1m.confidence * 0.75; // discount for using only fast tf
  } else if (tf1m.direction === tf5m.direction) {
    confidence = Math.min(1, (tf1m.confidence + tf5m.confidence) / 1.5);
  } else if (tf1m.direction !== "neutral" && tf1m.direction !== tf5m.direction) {
    confidence = Math.max(0, confidence - 0.15); // conflicting fast tf lowers conviction
  }

  return {
    price,
    tf1m,
    tf5m,
    combined: {
      direction,
      confidence,
      reasons: [...tf1m.reasons, ...tf5m.reasons],
    },
    roundLevel: round?.nearest ?? null,
  };
}
