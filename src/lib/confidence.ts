// Composite Confidence Score (0-100) for a Kalshi live market.
// Blends fair-value edge, outcome lean agreement, momentum, liquidity, and game progress.

import type { LiveGameStats, FairValue } from "@/lib/espn.functions";
import type { MovementSignal } from "@/lib/movement";

export type Grade = "A" | "B" | "C" | "D";

export interface ConfidenceScore {
  score: number; // 0..100
  grade: Grade;
  parts: {
    edge: number;       // /40
    lean: number;       // /20
    momentum: number;   // /15
    liquidity: number;  // /15
    progress: number;   // /10
  };
}

export interface ConfidenceInput {
  fv: FairValue | null;
  stats: LiveGameStats | null;
  movement: MovementSignal;
  volume24h: number;
}

export function computeConfidence({ fv, stats, movement, volume24h }: ConfidenceInput): ConfidenceScore {
  // Edge: 0pts = 0, 25pts+ = full 40.
  const edge = fv ? clamp((fv.edgePts / 25) * 40, 0, 40) : 0;

  // Outcome lean agrees with YES side.
  let lean = 0;
  if (fv && stats?.outcomeLean?.favored) {
    const yesTeamName = fv.yesTeam === "home" ? stats.home.name : stats.away.name;
    const noTeamName = fv.yesTeam === "home" ? stats.away.name : stats.home.name;
    const leanMag = stats.outcomeLean.lean / 100; // 0..1
    if (stats.outcomeLean.favored === yesTeamName) lean = 20 * leanMag;
    else if (stats.outcomeLean.favored === noTeamName) lean = 0;
    else lean = 10 * leanMag; // unrelated favored — partial
  } else if (!stats) {
    lean = 10; // neutral when no stats (don't over-penalize)
  }

  // Momentum: buy_dip = full, fade_spike = 0, rising/falling info = half, none = neutral half.
  let momentum = 7;
  switch (movement.kind) {
    case "buy_dip": momentum = 15; break;
    case "fade_spike": momentum = 0; break;
    case "rising":
    case "falling": momentum = 7; break;
    case null: momentum = 7; break;
  }

  // Liquidity: log scale, $10k+ vol24h = full 15.
  const v = Math.max(0, volume24h);
  const liquidity = clamp((Math.log10(v + 1) / Math.log10(10_000)) * 15, 0, 15);

  // Game progress: later in the game = higher confidence (less variance left).
  // Without a unified progressPct, approximate from period: 1→.25, 2→.5, 3→.75, 4+→1.
  let progress = 5; // pre/unknown = mid
  if (stats?.state === "in") {
    progress = clamp((stats.period / 4) * 10, 2, 10);
  } else if (stats?.state === "post") {
    progress = 10;
  }

  const total = edge + lean + momentum + liquidity + progress;
  const score = Math.round(clamp(total, 0, 100));

  return {
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D",
    parts: {
      edge: round1(edge),
      lean: round1(lean),
      momentum: round1(momentum),
      liquidity: round1(liquidity),
      progress: round1(progress),
    },
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
