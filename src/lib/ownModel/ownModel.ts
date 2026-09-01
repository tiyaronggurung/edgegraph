// Standalone "Own Model" BTC 15-minute engine — PURE logic, no I/O.
// Probability model + entry/exit rules. Every constant is versioned so a
// recalibration is auditable.

export const OWN_MODEL_VERSION = "v1-diffusion";

export type OwnSide = "YES" | "NO";

export interface OwnRules {
  minEdgeCents: number;
  minPriceCents: number;
  maxPriceCents: number;
  lateBlockSeconds: number;
  lateCushionUsd: number;
  maxPairCostCents: number;
  dominanceBlockCents: number;
  perSideWindowCapUsd: number;
  perWindowCapUsd: number;
  riskPerTradePct: number;
  stackFraction: number;
  stackGainCents: number;
  exitCapturePct: number;
  stopLossFraction: number;
  /* --- signal layer: Model pick / Study pick / Verdict --- */
  requireSignalAgreement: boolean;
  verdictVeto: boolean;
  blendStudy: boolean;
  studyWeight: number;
  minStudyConf: number;
}

export const OWN_RULES: OwnRules = {
  minEdgeCents: 8,
  minPriceCents: 50,
  maxPriceCents: 70,
  lateBlockSeconds: 300,
  lateCushionUsd: 60,
  maxPairCostCents: 96,
  dominanceBlockCents: 70,
  perSideWindowCapUsd: 300,
  perWindowCapUsd: 2000,
  riskPerTradePct: 1,
  stackFraction: 0.5,
  stackGainCents: 9,
  exitCapturePct: 92,
  stopLossFraction: 0.5,
  requireSignalAgreement: true,
  verdictVeto: true,
  blendStudy: true,
  studyWeight: 0.4,
  minStudyConf: 0.7,
};

export type SkipCode =
  | "EDGE_TOO_SMALL"
  | "PRICE_OUT_OF_BAND"
  | "LATE_WINDOW"
  | "SIDE_CAP_REACHED"
  | "WINDOW_CAP_REACHED"
  | "DOMINANCE_BLOCK"
  | "INSUFFICIENT_FUNDS"
  | "NO_MARKET"
  | "ALREADY_STACKED"
  | "NO_SIGNAL"
  | "VERDICT_SKIP"
  | "SIGNAL_DISAGREE"
  | "SIGNAL_MISSING"
  | "LOW_STUDY_CONF";

/* ----------------------------------------------------- signal layer types */

/** Live Model pick / Study pick / consensus Verdict for this window. */
export interface OwnSignals {
  modelSide: OwnSide | null;
  modelConf: number | null;
  studySide: OwnSide | null;
  studyConf: number | null;
  verdict: "ALLOW" | "CAUTION" | "SKIP" | null;
}

/**
 * Blend the diffusion probability with the Study pick so the Own Engine
 * trades OUR signals, not just its own math.
 */
export function blendWithSignals(
  prob: ProbResult,
  s: OwnSignals | null,
  rules: OwnRules,
): ProbResult {
  if (!s || !rules.blendStudy || !s.studySide || s.studyConf == null) return prob;
  const w = clamp(rules.studyWeight, 0, 1);
  const studyProbUp = s.studySide === "YES" ? s.studyConf : 1 - s.studyConf;
  const blended = clamp(prob.probUp * (1 - w) + studyProbUp * w, 0.015, 0.985);
  return { ...prob, probUp: blended };
}

/** Hard signal gate; null = pass. */
export function signalGate(
  side: OwnSide,
  s: OwnSignals | null,
  rules: OwnRules,
): { code: SkipCode; reason: string } | null {
  if (rules.verdictVeto && s?.verdict === "SKIP") {
    return { code: "VERDICT_SKIP", reason: "consensus verdict = SKIP" };
  }
  if (!rules.requireSignalAgreement) return null;
  if (!s || (!s.studySide && !s.modelSide)) {
    return { code: "SIGNAL_MISSING", reason: "no model/study pick for this window yet" };
  }
  if (s.studySide && s.studySide !== side) {
    return { code: "SIGNAL_DISAGREE", reason: `study pick ${s.studySide} vs own ${side}` };
  }
  if (s.modelSide && s.modelSide !== side) {
    return { code: "SIGNAL_DISAGREE", reason: `model pick ${s.modelSide} vs own ${side}` };
  }
  if (s.studySide && s.studyConf != null && s.studyConf < rules.minStudyConf) {
    return {
      code: "LOW_STUDY_CONF",
      reason: `study conf ${(s.studyConf * 100).toFixed(0)}% < ${(rules.minStudyConf * 100).toFixed(0)}%`,
    };
  }
  return null;
}


/* ------------------------------------------------------------------ model */

export function normCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 on erf.
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

export interface ProbInputs {
  cushionUsd: number;
  secondsLeft: number;
  vol1m: number;
  spotUsd: number;
  driftUsdPerMin?: number;
  bookImbalance?: number;
}

export interface ProbResult {
  probUp: number;
  z: number;
  expectedMoveUsd: number;
  version: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Diffusion estimate of P(BTC closes above strike). */
export function probUp(i: ProbInputs): ProbResult {
  const minutes = Math.max(i.secondsLeft, 1) / 60;
  const expectedMoveUsd = Math.max(
    1,
    i.spotUsd * Math.max(i.vol1m, 0.00035) * Math.sqrt(minutes),
  );
  const driftTerm = (i.driftUsdPerMin ?? 0) * minutes * 0.55;
  const z = (i.cushionUsd + driftTerm) / expectedMoveUsd + (i.bookImbalance ?? 0) * 0.12;
  return {
    probUp: clamp(normCdf(z), 0.015, 0.985),
    z,
    expectedMoveUsd,
    version: OWN_MODEL_VERSION,
  };
}

/** Realized 1-minute stdev of log returns from 1m closes (fraction). */
export function realizedVol1m(closes: number[]): number {
  const rets: number[] = [];
  for (let k = 1; k < closes.length; k++) {
    if (closes[k] > 0 && closes[k - 1] > 0) rets.push(Math.log(closes[k] / closes[k - 1]));
  }
  if (rets.length < 5) return 0.00035;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.max(Math.sqrt(varr), 0.00035);
}

/** USD drift per minute over the last 3 one-minute closes. */
export function driftUsdPerMin(closes: number[]): number {
  if (closes.length < 4) return 0;
  const tail = closes.slice(-4);
  return (tail[tail.length - 1] - tail[0]) / 3;
}

/* ------------------------------------------------------------------ entry */

export interface MarketSnapshot {
  askUpCents: number | null;
  bidUpCents: number | null;
  askDownCents: number | null;
  bidDownCents: number | null;
  secondsLeft: number;
  cushionUsd: number;
  feeCentsPerContract: number;
}

export interface BookState {
  /** Cumulative $ already spent this window, per side. */
  spentYesUsd: number;
  spentNoUsd: number;
  /** Highest live bid across held sides — dominance test. */
  heldSideBestBidCents: number | null;
  /** Sides we already stacked once. */
  stackedYes: boolean;
  stackedNo: boolean;
  /** Open directional legs, for the stack test. */
  openYes: { contracts: number; avgCostCents: number } | null;
  openNo: { contracts: number; avgCostCents: number } | null;
}

export interface EntryDecision {
  action: "PAIR_LOCK" | "DIRECTIONAL" | "STACK" | "SKIP";
  side?: OwnSide;
  contracts?: number;
  priceCents?: number;
  /** Pair lock buys both legs. */
  pair?: { contracts: number; upCents: number; downCents: number; lockedProfitCents: number };
  code?: SkipCode;
  reason: string;
  modelProbUp: number;
  edgeCents?: number;
  z: number;
}

/** Contracts for a directional entry: risk% of bankroll / price. */
export function sizeContracts(
  bankrollCents: number,
  riskPct: number,
  priceCents: number,
  perSideCapUsd: number,
  alreadySpentUsd: number,
  cashCents: number,
): number {
  if (priceCents <= 0) return 0;
  const riskCents = bankrollCents * (riskPct / 100);
  let n = Math.floor(riskCents / priceCents);
  const roomUsd = Math.max(0, perSideCapUsd - alreadySpentUsd);
  n = Math.min(n, Math.floor((roomUsd * 100) / priceCents));
  n = Math.min(n, Math.floor(cashCents / priceCents));
  return Math.max(0, n);
}

export function decideEntry(
  m: MarketSnapshot,
  probRaw: ProbResult,
  book: BookState,
  rules: OwnRules,
  bankrollCents: number,
  cashCents: number,
  signals: OwnSignals | null = null,
): EntryDecision {
  const prob = blendWithSignals(probRaw, signals, rules);
  const base = { modelProbUp: prob.probUp, z: prob.z };

  const fee = m.feeCentsPerContract;

  if (m.askUpCents == null || m.askDownCents == null) {
    return { action: "SKIP", code: "NO_MARKET", reason: "no two-sided market", ...base };
  }

  const windowSpend = book.spentYesUsd + book.spentNoUsd;
  if (windowSpend >= rules.perWindowCapUsd) {
    return { action: "SKIP", code: "WINDOW_CAP_REACHED", reason: `window cap $${rules.perWindowCapUsd} hit`, ...base };
  }

  /* 1 — PAIR LOCK */
  const pairCost = m.askUpCents + m.askDownCents + 2 * fee;
  if (pairCost <= rules.maxPairCostCents) {
    const capUsd = Math.min(
      rules.perSideWindowCapUsd - book.spentYesUsd,
      rules.perSideWindowCapUsd - book.spentNoUsd,
      rules.perWindowCapUsd - windowSpend,
    );
    const perPairCents = m.askUpCents + m.askDownCents;
    const n = Math.min(
      Math.floor((capUsd * 100) / perPairCents),
      Math.floor(cashCents / perPairCents),
    );
    if (n >= 1) {
      return {
        action: "PAIR_LOCK",
        pair: {
          contracts: n,
          upCents: m.askUpCents,
          downCents: m.askDownCents,
          lockedProfitCents: Math.round((100 - pairCost) * n),
        },
        reason: `pair lock ${pairCost.toFixed(0)}¢ combined → ${(100 - pairCost).toFixed(0)}¢/pair locked`,
        ...base,
      };
    }
  }

  /* pick the side — Study pick leads when present, else our diffusion side */
  const ownSide: OwnSide = prob.probUp >= 0.5 ? "YES" : "NO";
  const side: OwnSide =
    rules.requireSignalAgreement && signals?.studySide ? signals.studySide : ownSide;
  const ask = side === "YES" ? m.askUpCents : m.askDownCents;
  const bid = side === "YES" ? m.bidUpCents : m.bidDownCents;
  const modelSideProbCents = (side === "YES" ? prob.probUp : 1 - prob.probUp) * 100;
  const edge = modelSideProbCents - ask;

  /* signal gate — Model pick / Study pick / Verdict */
  const gate = signalGate(side, signals, rules);
  if (gate) {
    return { action: "SKIP", code: gate.code, reason: gate.reason, edgeCents: edge, ...base };
  }


  /* dominance block — held side ≥70¢ never buys the other side */
  const dom = book.heldSideBestBidCents;
  const holdsOther =
    (side === "YES" && (book.openNo?.contracts ?? 0) > 0) ||
    (side === "NO" && (book.openYes?.contracts ?? 0) > 0);
  if (dom != null && dom >= rules.dominanceBlockCents && holdsOther) {
    return { action: "SKIP", code: "DOMINANCE_BLOCK", reason: `held side at ${dom}¢ ≥ ${rules.dominanceBlockCents}¢`, edgeCents: edge, ...base };
  }

  /* 3 — STACK THE WINNER (before fresh entry: never average a loser) */
  const open = side === "YES" ? book.openYes : book.openNo;
  const stacked = side === "YES" ? book.stackedYes : book.stackedNo;
  if (open && open.contracts > 0 && bid != null) {
    const gain = bid - open.avgCostCents;
    if (gain >= rules.stackGainCents && !stacked && edge >= 0) {
      const spent = side === "YES" ? book.spentYesUsd : book.spentNoUsd;
      const n = Math.min(
        Math.floor(open.contracts * rules.stackFraction),
        Math.floor((Math.max(0, rules.perSideWindowCapUsd - spent) * 100) / ask),
        Math.floor(cashCents / ask),
      );
      if (n >= 1) {
        return {
          action: "STACK",
          side,
          contracts: n,
          priceCents: ask,
          edgeCents: edge,
          reason: `winner +${gain.toFixed(0)}¢ → stack ${n} @ ${ask}¢`,
          ...base,
        };
      }
      return { action: "SKIP", code: "INSUFFICIENT_FUNDS", reason: "no room to stack", edgeCents: edge, ...base };
    }
    return { action: "SKIP", code: stacked ? "ALREADY_STACKED" : "NO_SIGNAL", reason: stacked ? "side already stacked once" : `holding ${side}, +${gain.toFixed(0)}¢ < +${rules.stackGainCents}¢`, edgeCents: edge, ...base };
  }

  /* 2 — DIRECTIONAL */
  if (edge < rules.minEdgeCents) {
    return { action: "SKIP", code: "EDGE_TOO_SMALL", reason: `edge ${edge.toFixed(1)}¢ < ${rules.minEdgeCents}¢`, edgeCents: edge, ...base };
  }
  if (ask < rules.minPriceCents || ask > rules.maxPriceCents) {
    return { action: "SKIP", code: "PRICE_OUT_OF_BAND", reason: `ask ${ask}¢ outside ${rules.minPriceCents}–${rules.maxPriceCents}¢`, edgeCents: edge, ...base };
  }
  const cushionFavours =
    (side === "YES" && m.cushionUsd >= rules.lateCushionUsd) ||
    (side === "NO" && -m.cushionUsd >= rules.lateCushionUsd);
  if (m.secondsLeft <= rules.lateBlockSeconds && !cushionFavours) {
    return { action: "SKIP", code: "LATE_WINDOW", reason: `T−${m.secondsLeft}s and cushion $${m.cushionUsd.toFixed(0)} < $${rules.lateCushionUsd}`, edgeCents: edge, ...base };
  }
  const spent = side === "YES" ? book.spentYesUsd : book.spentNoUsd;
  if (spent >= rules.perSideWindowCapUsd) {
    return { action: "SKIP", code: "SIDE_CAP_REACHED", reason: `side cap $${rules.perSideWindowCapUsd} hit`, edgeCents: edge, ...base };
  }
  const n = sizeContracts(bankrollCents, rules.riskPerTradePct, ask, rules.perSideWindowCapUsd, spent, cashCents);
  if (n < 1) {
    return { action: "SKIP", code: "INSUFFICIENT_FUNDS", reason: "sized to 0 contracts", edgeCents: edge, ...base };
  }
  return {
    action: "DIRECTIONAL",
    side,
    contracts: n,
    priceCents: ask,
    edgeCents: edge,
    reason: `edge ${edge.toFixed(1)}¢ @ ${ask}¢ → ${n} contracts`,
    ...base,
  };
}

/* ------------------------------------------------------------------- exit */

export interface ExitDecision {
  exit: boolean;
  reason: string;
  capturePct: number | null;
}

export function decideExit(
  pos: { side: OwnSide; avgCostCents: number; phase: string },
  m: { bidCents: number | null },
  prob: ProbResult,
  rules: OwnRules,
): ExitDecision {
  if (pos.phase === "pair_lock") return { exit: false, reason: "matched pair — held to settlement", capturePct: null };
  if (m.bidCents == null) return { exit: false, reason: "no bid", capturePct: null };

  const upside = Math.max(1, 100 - pos.avgCostCents);
  const capture = ((m.bidCents - pos.avgCostCents) / upside) * 100;
  if (capture >= rules.exitCapturePct) {
    return { exit: true, reason: `captured ${capture.toFixed(0)}% ≥ ${rules.exitCapturePct}%`, capturePct: capture };
  }

  const modelSideProb = pos.side === "YES" ? prob.probUp : 1 - prob.probUp;
  if (m.bidCents <= pos.avgCostCents * rules.stopLossFraction && modelSideProb < 0.5) {
    return { exit: true, reason: `stop-loss: bid ${m.bidCents}¢ ≤ ${(rules.stopLossFraction * 100).toFixed(0)}% of cost and model flipped`, capturePct: capture };
  }
  return { exit: false, reason: `hold — capture ${capture.toFixed(0)}%`, capturePct: capture };
}
