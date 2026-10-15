// Option B 2.0 — pure decision helpers (paper only). Our screen odds lead Kalshi's book,
// so when our odds turn against the held side we buy the opposite side before Kalshi reprices.

export const B_ENTRY_ODDS = 0.65; // our odds on a side to open leg 1
export const B_ENTRY_MIN_MS = 90_000; // skip the first 90s
export const B_ENTRY_MAX_MS = 600_000; // no new entries after minute 10
export const B_PEAK_ODDS = 0.8; // leg 1 must have run to this before a reversal lock
export const B_REVERSAL_ODDS = 0.65; // reversal lock fires when our odds fall back to this
export const B_RESCUE_ODDS = 0.38; // failed trade: rescue when our odds fall to this
export const B_RESCUE_MAX_ASK = 0.5; // rescue only if the opposite side is still this cheap

export const kalshiFee = (contracts: number, px: number) =>
  Math.ceil(0.07 * contracts * px * (1 - px) * 100 - 1e-9) / 100;

export type BHedgeInput = {
  heldOddsSinceEntry: number[]; // our odds for the held side, every saved point since entry
  heldOddsNow: number;
  heldContracts: number;
  heldCost: number; // recorded leg-1 cost incl. fee
  oppAsk: number | null; // Kalshi's live ask for the opposite side (0–1)
};

export type BHedgeDecision = { kind: "lock" | "rescue"; contracts: number; px: number; cost: number; pairPayout: number; why: string };

// Returns a contract-matched opposite leg, or null. Lock requires a guaranteed profit
// (both legs + fees < payout); rescue only requires the loss to shrink vs. holding to zero.
export function decideBHedge(i: BHedgeInput): BHedgeDecision | null {
  const { heldContracts: ct, heldCost, oppAsk: px, heldOddsNow: now } = i;
  if (!(ct >= 1) || px == null || !(px > 0 && px < 1) || !Number.isFinite(now)) return null;
  const peak = Math.max(now, ...i.heldOddsSinceEntry.filter(Number.isFinite));
  const cost = Math.round((ct * px + kalshiFee(ct, px)) * 100) / 100;
  const total = heldCost + cost;
  const fmt = (v: number) => `${Math.round(v * 100)}¢`;
  if (peak >= B_PEAK_ODDS && now <= B_REVERSAL_ODDS && total < ct) {
    return { kind: "lock", contracts: ct, px, cost, pairPayout: ct,
      why: `reversal lock: our odds peaked ${fmt(peak)} → ${fmt(now)} · Kalshi opp ask ${fmt(px)} · ${ct} pairs cost $${total.toFixed(2)} → pays $${ct.toFixed(2)} (+$${(ct - total).toFixed(2)} guaranteed)` };
  }
  if (now <= B_RESCUE_ODDS && px <= B_RESCUE_MAX_ASK && total - ct < heldCost) {
    return { kind: "rescue", contracts: ct, px, cost, pairPayout: ct,
      why: `rescue hedge: our odds fell to ${fmt(now)} · Kalshi opp ask ${fmt(px)} · worst case ${ct - total >= 0 ? "+" : "−"}$${Math.abs(ct - total).toFixed(2)} instead of −$${heldCost.toFixed(2)}` };
  }
  return null;
}
