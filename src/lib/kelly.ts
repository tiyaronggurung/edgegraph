// Kelly-Lite stake sizer — pure function. Quarter-Kelly default keeps variance low.
// f* = (p*b - q) / b, where b = (1 - yesPrice) / yesPrice (decimal payoff per $1 risked).
export type RiskTolerance = "Low" | "Medium" | "High";

const RISK_MULT: Record<RiskTolerance, number> = {
  Low: 0.10,
  Medium: 0.25, // classic quarter-Kelly
  High: 0.50,
};

// Absolute safety rail — never stake more than this fraction of bankroll.
const HARD_CAP_PCT = 0.05;

export interface KellyInputs {
  fairProb: number; // 0..1
  yesPrice: number; // 0..1, cost per YES share
  bankroll: number;
  riskTolerance: RiskTolerance;
  unit: number; // round stake to nearest multiple of this
}

export interface KellySuggestion {
  stake: number; // dollars, rounded to nearest unit
  fractionPct: number; // % of bankroll being staked
  kellyPct: number; // raw Kelly %
  scaledKellyPct: number; // after risk multiplier + cap
  hasEdge: boolean;
}

export function computeKellyStake(inp: KellyInputs): KellySuggestion {
  const p = inp.fairProb;
  const q = 1 - p;
  const price = Math.max(0.01, Math.min(0.99, inp.yesPrice));
  const b = (1 - price) / price; // payoff per $1
  const kelly = (p * b - q) / b; // raw Kelly fraction
  const kellyPct = kelly * 100;

  if (kelly <= 0 || !Number.isFinite(kelly)) {
    return { stake: 0, fractionPct: 0, kellyPct, scaledKellyPct: 0, hasEdge: false };
  }

  const mult = RISK_MULT[inp.riskTolerance] ?? RISK_MULT.Medium;
  const scaled = Math.min(kelly * mult, HARD_CAP_PCT);
  const rawStake = scaled * Math.max(0, inp.bankroll);
  const unit = Math.max(1, inp.unit || 1);
  const stake = Math.max(0, Math.round(rawStake / unit) * unit);

  return {
    stake,
    fractionPct: inp.bankroll > 0 ? (stake / inp.bankroll) * 100 : 0,
    kellyPct,
    scaledKellyPct: scaled * 100,
    hasEdge: true,
  };
}

// Dollar stake at fractional-Kelly multipliers (¼, ½, full of raw Kelly).
// Hard-caps at 5% of bankroll per ticket, rounds to nearest unit.
export interface KellyPresets {
  quarter: number;
  half: number;
  full: number;
  hasEdge: boolean;
  kellyPct: number;
}
export function computeKellyPresets(
  fairProb: number,
  yesPrice: number,
  bankroll: number,
  unit: number,
): KellyPresets {
  const p = fairProb;
  const q = 1 - p;
  const price = Math.max(0.01, Math.min(0.99, yesPrice));
  const b = (1 - price) / price;
  const kelly = (p * b - q) / b;
  if (!Number.isFinite(kelly) || kelly <= 0) {
    return { quarter: 0, half: 0, full: 0, hasEdge: false, kellyPct: kelly * 100 };
  }
  const u = Math.max(1, unit || 1);
  const round = (frac: number) => {
    const capped = Math.min(kelly * frac, HARD_CAP_PCT);
    const dollars = capped * Math.max(0, bankroll);
    return Math.max(0, Math.round(dollars / u) * u);
  };
  return {
    quarter: round(0.25),
    half: round(0.5),
    full: round(1.0),
    hasEdge: true,
    kellyPct: kelly * 100,
  };
}

