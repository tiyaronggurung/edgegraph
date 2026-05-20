// Rule-based AI engine for EdgeGraph AI.
// Designed so the body of runAnalysis() can later be swapped for an LLM call
// without changing callers.

import type { Sport } from "./sports";

export type Pattern =
  | "Dominant Lock"
  | "Controlled Stability"
  | "Breakaway Trend"
  | "Late Momentum Swing"
  | "V-Reversal"
  | "Fake Spike"
  | "Chaotic Coin Flip"
  | "Momentum Exhaustion"
  | "Sharp Money Recovery"
  | "Volatility Compression"
  | "Public Overreaction"
  | "Failed Rally"
  | "Favorite Confirmation"
  | "Underdog Trap"
  | "Late-Game Stability";

export type ActionType = "Bet" | "Wait" | "Hedge" | "Avoid" | "Watch Only";
export type Risk = "Low" | "Medium" | "Medium/High" | "High";

export interface AnalysisInput {
  sport: Sport;
  league?: string;
  gameName?: string;
  teamA?: string;
  teamB?: string;
  score?: string;
  timePeriod?: string;
  probabilityA: number;
  probabilityB: number;
  oddsA?: number;
  oddsB?: number;
  volume?: number;
  sportFields: Record<string, string | number | boolean | undefined>;
  notes: {
    live?: string;
    injury?: string;
    market?: string;
  };
}

export interface AnalysisResult {
  pattern: Pattern;
  predictedWinner: string;
  confidenceScore: number; // 0-100
  edgeScore: number; // 0-10
  edge70Detected: boolean;
  edge70Reason: string;
  riskLevel: Risk;
  recommendedAction: ActionType;
  momentum: "Up" | "Down" | "Flat";
  volatility: "Low" | "Medium" | "High";
  reasoning: string[];
}

const DANGEROUS: Pattern[] = [
  "Chaotic Coin Flip",
  "Fake Spike",
  "Public Overreaction",
  "Underdog Trap",
];

const noteIncludes = (input: AnalysisInput, ...keys: string[]) => {
  const blob = `${input.notes.live ?? ""} ${input.notes.injury ?? ""} ${input.notes.market ?? ""}`.toLowerCase();
  return keys.some((k) => blob.includes(k));
};

export function classifyPattern(input: AnalysisInput): Pattern {
  const probTop = Math.max(input.probabilityA, input.probabilityB);
  const sf = input.sportFields;

  if (noteIncludes(input, "spike") && noteIncludes(input, "collapse")) return "Fake Spike";
  if (noteIncludes(input, "reversal")) return "V-Reversal";
  if (noteIncludes(input, "chaotic", "swinging")) return "Chaotic Coin Flip";
  if (noteIncludes(input, "overreact")) return "Public Overreaction";
  if (noteIncludes(input, "sharp money")) return "Sharp Money Recovery";
  if (noteIncludes(input, "exhaustion")) return "Momentum Exhaustion";
  if (noteIncludes(input, "compression")) return "Volatility Compression";
  if (noteIncludes(input, "trap")) return "Underdog Trap";
  if (noteIncludes(input, "failed rally")) return "Failed Rally";

  // Sport-specific overrides
  switch (input.sport) {
    case "NBA": {
      const q = String(sf.quarter ?? "");
      const remaining = Number(sf.timeRemainingMin ?? sf.timeRemaining ?? 99);
      if (q.includes("4") && remaining < 5 && probTop >= 80) return "Late-Game Stability";
      break;
    }
    case "NFL": {
      if (String(sf.fieldPosition ?? "").toLowerCase().includes("red zone") && probTop >= 65)
        return "Breakaway Trend";
      break;
    }
    case "NHL": {
      if (sf.powerPlay) return "Breakaway Trend";
      break;
    }
    case "MLB": {
      const inning = Number(sf.inning ?? 0);
      if (inning >= 7 && probTop >= 75) return "Late Momentum Swing";
      break;
    }
    case "Tennis": {
      if (sf.tiebreak) return "Chaotic Coin Flip";
      break;
    }
    case "Soccer": {
      const minute = Number(sf.minute ?? 0);
      if (minute >= 75 && probTop >= 70) return "Late Momentum Swing";
      break;
    }
  }

  if (probTop >= 90) return "Dominant Lock";
  if (probTop >= 75) return "Controlled Stability";
  if (probTop >= 60) return "Breakaway Trend";
  if (probTop < 55) return "Chaotic Coin Flip";
  return "Volatility Compression";
}

export function computeEdgeScore(probTop: number, pattern: Pattern): number {
  let base = ((probTop - 50) / 50) * 10;
  const bonus: Partial<Record<Pattern, number>> = {
    "Dominant Lock": 2,
    "Controlled Stability": 1.5,
    "Late-Game Stability": 1.8,
    "Favorite Confirmation": 1.5,
    "Sharp Money Recovery": 1,
    "Breakaway Trend": 0.8,
  };
  const penalty: Partial<Record<Pattern, number>> = {
    "Chaotic Coin Flip": -3,
    "Fake Spike": -2.5,
    "Public Overreaction": -2,
    "Underdog Trap": -1.8,
    "Momentum Exhaustion": -1,
    "V-Reversal": -0.5,
  };
  base += bonus[pattern] ?? 0;
  base += penalty[pattern] ?? 0;
  return Math.max(0, Math.min(10, Number(base.toFixed(2))));
}

export function computeEdge70(
  input: AnalysisInput,
  pattern: Pattern,
): { detected: boolean; reason: string } {
  const probTop = Math.max(input.probabilityA, input.probabilityB);
  if (probTop <= 70) return { detected: false, reason: "Probability under 70% — no Edge70 threshold." };
  if (DANGEROUS.includes(pattern)) return { detected: false, reason: `Pattern ${pattern} is too volatile for Edge70.` };

  const sf = input.sportFields;
  switch (input.sport) {
    case "NBA": {
      const q = String(sf.quarter ?? "");
      const remaining = Number(sf.timeRemainingMin ?? sf.timeRemaining ?? 99);
      if (q.includes("4") && remaining < 2 && probTop < 85)
        return { detected: false, reason: "Q4 under 2:00 needs ≥85% probability." };
      if (sf.foulTrouble) return { detected: false, reason: "Foul trouble on key player blocks Edge70." };
      return { detected: true, reason: `NBA: stable late-game probability of ${probTop.toFixed(1)}% with no foul-trouble flag.` };
    }
    case "NFL": {
      if (noteIncludes(input, "turnover")) return { detected: false, reason: "Turnover risk noted — Edge70 blocked." };
      const q = String(sf.quarter ?? "");
      if (q.includes("4") && Number(sf.timeouts ?? 3) === 0)
        return { detected: false, reason: "Zero timeouts in Q4 blocks Edge70." };
      return { detected: true, reason: `NFL: ${probTop.toFixed(1)}% probability with timeouts available and no turnover flag.` };
    }
    case "NHL": {
      if (sf.powerPlay) return { detected: false, reason: "Active power play blocks Edge70." };
      if (probTop < 78) return { detected: false, reason: "NHL requires >78% probability." };
      return { detected: true, reason: `NHL: ${probTop.toFixed(1)}% probability at even strength.` };
    }
    case "MLB": {
      const inning = Number(sf.inning ?? 0);
      if (inning < 7) return { detected: false, reason: "Inning <7 blocks Edge70." };
      if (noteIncludes(input, "bullpen depleted")) return { detected: false, reason: "Depleted bullpen blocks Edge70." };
      return { detected: true, reason: `MLB: inning ${inning} with ${probTop.toFixed(1)}% probability and rested bullpen.` };
    }
    case "Tennis": {
      if (sf.tiebreak) return { detected: false, reason: "Tiebreak volatility blocks Edge70." };
      if (sf.breakPoints && probTop < 80)
        return { detected: false, reason: "Active break points need ≥80% probability." };
      return { detected: true, reason: `Tennis: ${probTop.toFixed(1)}% with no live break points.` };
    }
    case "Soccer": {
      const minute = Number(sf.minute ?? 0);
      if (minute < 60) return { detected: false, reason: "Minute <60 blocks Edge70." };
      if (noteIncludes(input, "red card") && noteIncludes(input, "opponent"))
        return { detected: false, reason: "Red card on opponent — volatility too high." };
      if (noteIncludes(input, "draw risk"))
        return { detected: false, reason: "Draw risk noted — Edge70 blocked." };
      return { detected: true, reason: `Soccer: minute ${minute} with ${probTop.toFixed(1)}% probability.` };
    }
  }
  return { detected: true, reason: "Probability above 70% with safe pattern." };
}

export function recommendAction(
  edgeScore: number,
  edge70: boolean,
  pattern: Pattern,
): ActionType {
  if (DANGEROUS.includes(pattern)) return "Avoid";
  if (edgeScore >= 7.5 && edge70) return "Bet";
  if (edgeScore >= 5.5 && edge70) return "Wait";
  if (edgeScore >= 4) return "Hedge";
  return "Watch Only";
}

const PATTERN_RISK: Record<Pattern, Risk> = {
  "Dominant Lock": "Low",
  "Controlled Stability": "Low",
  "Late-Game Stability": "Low",
  "Favorite Confirmation": "Low",
  "Failed Rally": "Low",
  "Sharp Money Recovery": "Medium",
  "Breakaway Trend": "Medium",
  "V-Reversal": "Medium",
  "Momentum Exhaustion": "Medium",
  "Volatility Compression": "Medium",
  "Late Momentum Swing": "Medium/High",
  "Fake Spike": "High",
  "Chaotic Coin Flip": "High",
  "Public Overreaction": "High",
  "Underdog Trap": "High",
};

export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const probTop = Math.max(input.probabilityA, input.probabilityB);
  const winner =
    input.probabilityA >= input.probabilityB
      ? input.teamA || "Team A"
      : input.teamB || "Team B";
  const pattern = classifyPattern(input);
  const edgeScore = computeEdgeScore(probTop, pattern);
  const e70 = computeEdge70(input, pattern);
  const action = recommendAction(edgeScore, e70.detected, pattern);
  const risk = PATTERN_RISK[pattern];

  const momentum: AnalysisResult["momentum"] =
    noteIncludes(input, "climbing", "upward", "rising") ? "Up" :
    noteIncludes(input, "falling", "drop", "collapse") ? "Down" : "Flat";

  const volatility: AnalysisResult["volatility"] =
    DANGEROUS.includes(pattern) ? "High" :
    risk === "Medium" || risk === "Medium/High" ? "Medium" : "Low";

  const reasoning: string[] = [
    `Market favorite: ${winner} at ${probTop.toFixed(1)}% probability.`,
    `Detected pattern: ${pattern} (${risk} risk).`,
    e70.detected
      ? `Edge70 detected — ${e70.reason}`
      : `Edge70 NOT detected — ${e70.reason}`,
    `Edge score ${edgeScore.toFixed(1)}/10 → recommendation: ${action}.`,
  ];
  if (input.notes.live) reasoning.push(`Live note: ${input.notes.live}`);
  if (input.notes.injury) reasoning.push(`Injury/news: ${input.notes.injury}`);
  if (input.notes.market) reasoning.push(`Market movement: ${input.notes.market}`);

  return {
    pattern,
    predictedWinner: winner,
    confidenceScore: Math.round(probTop),
    edgeScore,
    edge70Detected: e70.detected,
    edge70Reason: e70.reason,
    riskLevel: risk,
    recommendedAction: action,
    momentum,
    volatility,
    reasoning,
  };
}

// Deterministic simulated probability series for the result-page chart.
export function generateSimulatedSeries(
  pattern: Pattern,
  finalProb: number,
  points = 40,
): number[] {
  const arr: number[] = [];
  const seed = pattern.length;
  const rand = (i: number) => {
    const x = Math.sin(i * 9301 + seed * 49297) * 233280;
    return x - Math.floor(x);
  };

  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    let v = 50;
    switch (pattern) {
      case "Dominant Lock":
      case "Late-Game Stability":
        v = 50 + (finalProb - 50) * Math.min(1, t * 3) + (rand(i) - 0.5) * 1.5;
        break;
      case "Controlled Stability":
      case "Favorite Confirmation":
        v = 50 + (finalProb - 50) * t + (rand(i) - 0.5) * 2.5;
        break;
      case "Breakaway Trend":
        v = 50 + (finalProb - 50) * (t < 0.4 ? t * 0.3 : 0.12 + (t - 0.4) * 1.6) + (rand(i) - 0.5) * 2;
        break;
      case "V-Reversal":
        v = 50 + (finalProb - 50) * (t < 0.5 ? -t * 1.4 : -0.7 + (t - 0.5) * 3.0) + (rand(i) - 0.5) * 2;
        break;
      case "Fake Spike":
        v = 50 + (finalProb - 50) * (t < 0.3 ? t * 3 : t < 0.5 ? 0.9 - (t - 0.3) * 4 : 0.1 + (t - 0.5) * 0.4) + (rand(i) - 0.5) * 3;
        break;
      case "Chaotic Coin Flip":
        v = 50 + (rand(i) - 0.5) * 40;
        break;
      case "Momentum Exhaustion":
        v = 50 + (finalProb - 50) * Math.min(1, t * 1.5) - (t > 0.7 ? (t - 0.7) * 30 : 0);
        break;
      case "Sharp Money Recovery":
        v = 50 + (finalProb - 50) * (t < 0.3 ? -t : t < 0.5 ? -0.3 : -0.3 + (t - 0.5) * 2.6) + (rand(i) - 0.5) * 2;
        break;
      case "Volatility Compression":
        v = (finalProb + 50) / 2 + Math.sin(i * (1 - t * 0.8)) * (10 - t * 8);
        break;
      case "Public Overreaction":
        v = 50 + (finalProb - 50) * (t < 0.4 ? t * 2.5 : 1 - (t - 0.4) * 1.2) + (rand(i) - 0.5) * 4;
        break;
      case "Failed Rally":
        v = finalProb - Math.abs(Math.sin(i * 0.6)) * 15;
        break;
      case "Underdog Trap":
        v = 50 + (finalProb - 50) * (1 - t * 0.5) + Math.sin(i * 0.4) * 5;
        break;
      case "Late Momentum Swing":
        v = 50 + (finalProb - 50) * (t < 0.7 ? t * 0.6 : 0.4 + (t - 0.7) * 2) + (rand(i) - 0.5) * 2;
        break;
    }
    arr.push(Math.max(2, Math.min(98, v)));
  }
  arr[arr.length - 1] = finalProb;
  return arr;
}
