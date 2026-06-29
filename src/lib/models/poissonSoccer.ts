// Pure statistical soccer model. No network calls. Runs on every tick for free.
// Produces probabilities for every market using Poisson approximation seeded
// from live stats (xG when present, shots on target × conversion otherwise).

import type { LiveMatchSnapshot } from "@/lib/providers/liveProvider";

const SOT_TO_GOAL = 0.31; // average conversion of shots on target
const SHOT_TO_GOAL = 0.10; // raw shot fallback
const BASE_CORNER_RATE_PER_MIN = 0.11; // ~10 corners per match
const FULL_MATCH_MIN = 95; // include stoppage

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function poissonCdf(lambda: number, k: number): number {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(lambda, i);
  return Math.min(1, s);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface MarketProb {
  market: string;
  pick: string;
  probability: number; // 0..1 for pick
  line?: number;
}

export interface StatsModelResult {
  // Expected remaining goals per side
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  lambdaCornersTotal: number;
  // Cooked probabilities, sum-to-1 sets where applicable
  winHome: number;
  draw: number;
  winAway: number;
  btts: number; // probability BTTS = YES
  nextGoalHome: number;
  nextGoalAway: number;
  nextGoalNone: number; // no more goals
  overGoals: Record<string, number>; // key "0.5","1.5","2.5","3.5","4.5"
  underGoals: Record<string, number>;
  overCorners: { line: number; over: number; under: number };
  // Markets array for convenient iteration
  markets: MarketProb[];
}

interface InferLambdaArgs {
  goalsScored: number; // already scored this match
  xg: number | null;
  shotsOnTarget: number | null;
  shots: number | null;
  elapsed: number;
  redCardOpp: boolean;
  redCardSelf: boolean;
}

function inferExpectedRemainingGoals(a: InferLambdaArgs): number {
  const minLeft = Math.max(0, FULL_MATCH_MIN - a.elapsed);
  if (minLeft === 0) return 0;
  // Per-minute rate: prefer xG (already reflects chances), else SoT, else shots, else baseline
  let perMin: number;
  if (a.xg != null && a.elapsed > 0) {
    perMin = a.xg / a.elapsed;
  } else if (a.shotsOnTarget != null && a.elapsed > 0) {
    perMin = (a.shotsOnTarget * SOT_TO_GOAL) / a.elapsed;
  } else if (a.shots != null && a.elapsed > 0) {
    perMin = (a.shots * SHOT_TO_GOAL) / a.elapsed;
  } else {
    perMin = 1.3 / 90; // ~1.3 goals per team baseline
  }
  // Blend with baseline for low-sample early game
  const sampleWeight = clamp(a.elapsed / 30, 0, 1);
  const blended = perMin * sampleWeight + (1.3 / 90) * (1 - sampleWeight);
  // Red card adjustments
  let adj = 1;
  if (a.redCardOpp) adj *= 1.25; // opp down a man → more goals
  if (a.redCardSelf) adj *= 0.75;
  return Math.max(0.02, blended * minLeft * adj);
}

export function computeStatsModel(snap: LiveMatchSnapshot): StatsModelResult {
  const elapsed = snap.elapsed ?? 0;
  const minLeft = Math.max(0, FULL_MATCH_MIN - elapsed);
  const homeRed = (snap.home.redCards ?? 0) > 0;
  const awayRed = (snap.away.redCards ?? 0) > 0;

  const lambdaHome = inferExpectedRemainingGoals({
    goalsScored: snap.goalsHome,
    xg: snap.home.expectedGoals,
    shotsOnTarget: snap.home.shotsOnTarget,
    shots: snap.home.shots,
    elapsed,
    redCardOpp: awayRed,
    redCardSelf: homeRed,
  });
  const lambdaAway = inferExpectedRemainingGoals({
    goalsScored: snap.goalsAway,
    xg: snap.away.expectedGoals,
    shotsOnTarget: snap.away.shotsOnTarget,
    shots: snap.away.shots,
    elapsed,
    redCardOpp: homeRed,
    redCardSelf: awayRed,
  });
  const lambdaTotal = lambdaHome + lambdaAway;

  // Corner expectation: extrapolate live rate
  const cornersSoFar = (snap.home.corners ?? 0) + (snap.away.corners ?? 0);
  const cornerRatePerMin =
    elapsed > 5 ? cornersSoFar / elapsed : BASE_CORNER_RATE_PER_MIN;
  const lambdaCornersTotal = cornersSoFar + cornerRatePerMin * minLeft;

  // 1X2: simulate goals distribution
  const maxGoals = 6;
  let winHome = 0,
    draw = 0,
    winAway = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(lambdaHome, h) * poissonPmf(lambdaAway, a);
      const finalH = snap.goalsHome + h;
      const finalA = snap.goalsAway + a;
      if (finalH > finalA) winHome += p;
      else if (finalH < finalA) winAway += p;
      else draw += p;
    }
  }
  const wsum = winHome + draw + winAway || 1;
  winHome /= wsum;
  draw /= wsum;
  winAway /= wsum;

  // BTTS
  let btts: number;
  if (snap.goalsHome > 0 && snap.goalsAway > 0) {
    btts = 1;
  } else if (snap.goalsHome > 0) {
    btts = 1 - poissonPmf(lambdaAway, 0); // P(away scores ≥1)
  } else if (snap.goalsAway > 0) {
    btts = 1 - poissonPmf(lambdaHome, 0);
  } else {
    btts = (1 - poissonPmf(lambdaHome, 0)) * (1 - poissonPmf(lambdaAway, 0));
  }

  // Next goal
  const pNoGoal = poissonPmf(lambdaTotal, 0);
  const homeShare = lambdaTotal > 0 ? lambdaHome / lambdaTotal : 0.5;
  const nextGoalHome = (1 - pNoGoal) * homeShare;
  const nextGoalAway = (1 - pNoGoal) * (1 - homeShare);
  const nextGoalNone = pNoGoal;

  // O/U total goals (final = goals already + remaining; remaining ~ Poisson(lambdaTotal))
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const overGoals: Record<string, number> = {};
  const underGoals: Record<string, number> = {};
  const scored = snap.goalsHome + snap.goalsAway;
  for (const line of lines) {
    // Need final > line → remaining > line - scored → remaining ≥ floor(line - scored) + 1
    const need = line - scored;
    if (need < 0) {
      overGoals[line.toString()] = 1;
      underGoals[line.toString()] = 0;
    } else {
      const k = Math.floor(need);
      const under = poissonCdf(lambdaTotal, k);
      overGoals[line.toString()] = 1 - under;
      underGoals[line.toString()] = under;
    }
  }

  // Corners O/U 9.5
  const cornerLine = 9.5;
  const cornersExtra = lambdaCornersTotal - cornersSoFar;
  const needCorners = cornerLine - cornersSoFar;
  const overCornersProb =
    needCorners < 0 ? 1 : 1 - poissonCdf(cornersExtra, Math.floor(needCorners));

  const markets: MarketProb[] = [
    { market: "1X2", pick: "HOME", probability: winHome },
    { market: "1X2", pick: "DRAW", probability: draw },
    { market: "1X2", pick: "AWAY", probability: winAway },
    { market: "BTTS", pick: "YES", probability: btts },
    { market: "BTTS", pick: "NO", probability: 1 - btts },
    { market: "NEXT_GOAL", pick: "HOME", probability: nextGoalHome },
    { market: "NEXT_GOAL", pick: "AWAY", probability: nextGoalAway },
    { market: "NEXT_GOAL", pick: "NONE", probability: nextGoalNone },
    ...lines.flatMap((line) => [
      { market: "GOALS", pick: "OVER", line, probability: overGoals[line.toString()] },
      { market: "GOALS", pick: "UNDER", line, probability: underGoals[line.toString()] },
    ]),
    { market: "CORNERS", pick: "OVER", line: cornerLine, probability: overCornersProb },
    { market: "CORNERS", pick: "UNDER", line: cornerLine, probability: 1 - overCornersProb },
  ];

  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal,
    lambdaCornersTotal,
    winHome,
    draw,
    winAway,
    btts,
    nextGoalHome,
    nextGoalAway,
    nextGoalNone,
    overGoals,
    underGoals,
    overCorners: { line: cornerLine, over: overCornersProb, under: 1 - overCornersProb },
    markets,
  };
}
